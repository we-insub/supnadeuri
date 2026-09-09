import { Upstream } from './upstream.mjs';
import {
  parseForests,
  parseRooms,
  parseClasses,
  parseDetail,
} from './parsers.mjs';
import {
  groupsFor,
  requestFields,
  locationFor,
  normalizeRoom,
  validateQuery,
} from './normalize.mjs';
import { SourceError, health, log } from './errors.mjs';
async function pool(items, fn, n = 3) {
  let index = 0;
  const result = Array.from({length:items.length});
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (index < items.length) {
        const i = index++;
        result[i] = await fn(items[i], i);
      }
    }),
  );
  return result;
}
export class SearchService {
  constructor(upstream = new Upstream()) {
    this.upstream = upstream;
    this.cache = new Map();
    this.pending = new Map();
    this.classes = new Map();
  }
  async search(input) {
    const q = validateQuery(input);
    const key = JSON.stringify(q);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now())
      return { ...cached.data, cached: true };
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.pending.size)
      throw new SourceError(
        'BUSY',
        '다른 조건을 조회 중입니다. 잠시 후 다시 시도해 주세요.',
        429,
      );
    const promise = this.collect(q)
      .then((data) => {
        if (data.complete) {
          this.cache.set(key, { expires: Date.now() + 60000, data });
          while (this.cache.size > 10)
            this.cache.delete(this.cache.keys().next().value);
        }
        return data;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  async collect(q) {
    const started = Date.now(),
      signal = AbortSignal.timeout(180000);
    const warnings = [];
    const rooms = [];
    const groups = groupsFor(q.regions);
    let regionSuccess = 0,
      checked = 0,
      total = 0;
    const regions = await pool(groups, async (group) => {
      try {
        const body = await this.upstream.post(
          '/rep/or/innerFcfsRcrfrDtlDetls.do',
          {
            ...requestFields(q),
            srchInsttArcd: group,
            houseCampSctin: '01',
            rsrvtPssblYn: 'N',
            srchHouseCharg: '',
            srchHouseOver: '이상',
            srchCampCharg: '',
            srchCampOver: '이상',
            srchMyLtd: '',
            srchMyLng: '',
            srchDstnc: '',
            srchDstncOver: '이상',
            srtngOrdr: 'rsrvtPssbl',
            goodsClsscHouseCdArr: [],
            goodsClsscCampCdArr: [],
            srchInsttTpcd: [],
            cmdogYn: 'N',
            bbqYn: 'N',
            dsprsYn: 'N',
            otsdWeterYn: 'N',
            wifiYn: 'N',
            snowPlaceYn: 'N',
          },
          signal,
        );
        const forests = parseForests(body);
        regionSuccess++;
        return forests;
      } catch (e) {
        warnings.push(`지역 그룹 ${group}: ${e.message}`);
        log('region_failure', { group, code: e.code || 'UNKNOWN' });
        return [];
      }
    });
    if (!regionSuccess)
      throw new SourceError(
        'SEARCH_FAILED',
        warnings[0] || '숲나들e 조회에 실패했습니다.',
        503,
      );
    const forests = [...new Map(regions.flat().map((f) => [f.id, f])).values()];
    const candidates = [];
    for (const f of forests) {
      if (!/휴양림/.test(f.name)) continue;
      try {
        const loc = locationFor(f);
        if (q.regions.length && !q.regions.includes(loc.province)) continue;
        total++;
        if (!f.available || !f.availableCount) {
          checked++;
          continue;
        }
        candidates.push(f);
      } catch {
        total++;
        warnings.push(`${f.name}: 소재지 확인 실패`);
      }
    }
    await pool(candidates, async (forest) => {
      try {
        let classes = this.classes.get(forest.id);
        if (!classes || classes.expires < Date.now()) {
          classes = {
            map: parseClasses(
              await this.upstream.post(
                '/rep/cm/selectGoodsClsscList.do',
                [
                  {
                    trgtObj: 'objGsrm',
                    codeId: forest.id,
                    upperDetailCode: '01',
                  },
                ],
                signal,
              ),
            ),
            expires: Date.now() + 43200000,
          };
          this.classes.set(forest.id, classes);
        }
        if (!classes.map.size)
          throw new SourceError('CLASS_SCHEMA', '숙박 분류가 없습니다.');
        const ids = new Set();
        let pages = 1;
        for (let page = 1; page <= pages; page++) {
          const parsed = parseRooms(
            await this.upstream.post(
              '/rep/or/sssn/innerFcfsRsrvtPssblGoodsDetls.do',
              {
                ...requestFields(q, forest.id),
                houseCampSctin: '01',
                rsrvtWtngSctin: '01',
                gNowPage: String(page),
                srtngOrdr: 'goodsClsscCd',
                goodsClsscHouseCdArr: [...classes.map.keys()],
                allNanChkGoodsClssCd: 'N',
              },
              signal,
            ),
            page,
          );
          if (page === 1) pages = parsed.pages;
          else if (pages !== parsed.pages)
            throw new SourceError(
              'PAGINATION_CHANGED',
              '조회 중 객실 페이지 수가 변경되었습니다. 다시 조회해 주세요.',
            );
          for (const id of parsed.ids) {
            if (ids.has(id))
              throw new SourceError(
                'DUPLICATE_PAGE',
                '객실 페이지 중복이 감지되었습니다.',
              );
            ids.add(id);
          }
        }
        let detailFailed = false;
        await pool([...ids], async (id) => {
          try {
            const d = parseDetail(
              await this.upstream.post(
                '/rep/or/innerFcfsRsrvtPssblGoodsDtl.do',
                { ...requestFields(q, forest.id), srchGoodsId: id },
                signal,
              ),
            );
            const room = normalizeRoom(forest, id, d, q, classes.map);
            if (room) rooms.push(room);
            health.parsing_success++;
            log('room_success', { forest_id: forest.id, room_id: id });
          } catch (e) {
            detailFailed = true;
            health.parsing_failure++;
            warnings.push(`${forest.name}: 객실 ${id} 확인 실패`);
            log('room_failure', {
              forest_id: forest.id,
              room_id: id,
              code: e.code || 'UNKNOWN',
            });
          }
        });
        if (!detailFailed) checked++;
      } catch (e) {
        warnings.push(`${forest.name}: ${e.message}`);
        log('forest_failure', {
          forest_id: forest.id,
          code: e.code || 'UNKNOWN',
        });
      }
    });
    rooms.sort(
      (a, b) =>
        a.forest_name.localeCompare(b.forest_name, 'ko') ||
        a.room_name.localeCompare(b.room_name, 'ko'),
    );
    const complete = warnings.length === 0 && regionSuccess === groups.length;
    const checked_at = new Date().toISOString();
    if (complete) health.last_success_at = checked_at;
    else health.last_error = { at: checked_at, code: 'PARTIAL_SEARCH' };
    log('search_finished', {
      complete,
      room_count: rooms.length,
      forests_checked: checked,
      forests_total: total,
      duration_ms: Date.now() - started,
    });
    return {
      rooms,
      query: q,
      checked_at,
      cached: false,
      cache_ttl_seconds: 60,
      complete,
      forests_checked: checked,
      forests_total: total,
      regions_checked: regionSuccess,
      regions_total: groups.length,
      warnings: [...new Set(warnings)],
    };
  }
}
