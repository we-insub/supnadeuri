import { load } from 'cheerio';
import { SourceError, health, log } from './errors.mjs';
const text = (s) => s.replace(/\s+/g, ' ').trim();
export function parse(kind, body, fn) {
  try {
    const result = fn(load(body));
    health.parsing_success++;
    log('parse_success', { kind });
    return result;
  } catch (e) {
    health.parsing_failure++;
    log('parse_failure', { kind, code: e.code || 'PARSING_ERROR' });
    throw e instanceof SourceError
      ? e
      : new SourceError('PARSING_ERROR', '숲나들e 응답 구조가 변경되었습니다.');
  }
}
export function parseForests(body) {
  return parse('region', body, ($) => {
    const title = $('.search_con_ti').text();
    const count = Number(title.match(/(\d+)개의 휴양시설/)?.[1]);
    if (!Number.isInteger(count) || $('.rc_item').length !== count)
      throw new SourceError(
        'REGION_SCHEMA',
        '휴양림 목록 개수 또는 구조가 변경되었습니다.',
      );
    return $('.rc_item')
      .toArray()
      .map((el) => {
        const $el = $(el);
        const script = $el.next('script').html() || '';
        const field = (name) => {
          const match = script.match(
            new RegExp('(?:^|[,\\s])' + name + ':"((?:[^"\\\\]|\\\\.)*)"'),
          );
          return match ? JSON.parse('"' + match[1] + '"') : '';
        };
        const id = field('insttId');
        const name = field('insttNm');
        const status = $el.find('.rc_ti i').text();
        const rawCount = $el.find('.ut_roomcount').text();
        const availableCount = Number(
          rawCount.match(/예약가능 객실 수\s*:\s*(\d+)/)?.[1],
        );
        if (
          !id ||
          !name ||
          !Number.isInteger(availableCount) ||
          !/예약가능|예약불가/.test(status)
        )
          throw new SourceError(
            'REGION_SCHEMA',
            '휴양림 예약 상태 필드가 변경되었습니다.',
          );
        const image = $el.find('.st_img img').attr('src') || '';
        return {
          id,
          name,
          address: field('roadNm'),
          url: field('url'),
          image: image.startsWith('https://image.foresttrip.go.kr/')
            ? image
            : undefined,
          availableCount,
          available: status.includes('[예약가능]'),
        };
      });
  });
}
export function parseRooms(body, page = 1) {
  return parse('rooms', body, ($) => {
    const paging = $('.paging_count')
      .text()
      .match(/\((\d+)\/(\d+)\)/);
    if (!paging)
      throw new SourceError(
        'ROOM_SCHEMA',
        '객실 페이지 정보가 변경되었습니다.',
      );
    const current = Number(paging[1]),
      pages = Number(paging[2]);
    const nodes = $('.communication_list .list_box > a.item');
    const ids = nodes.toArray().map((el) => $(el).attr('data-value'));
    if (
      ids.some((id) => !id) ||
      new Set(ids).size !== ids.length ||
      pages > 100 ||
      (ids.length && current !== page) ||
      (!ids.length && (current !== 0 || pages !== 0))
    )
      throw new SourceError(
        'ROOM_SCHEMA',
        '객실 페이지가 누락되거나 중복되었습니다.',
      );
    return { ids, pages, current };
  });
}
export function parseClasses(body) {
  let rows;
  try {
    rows = JSON.parse(body);
  } catch {
    throw new SourceError('CLASS_SCHEMA', '시설 분류 응답이 변경되었습니다.');
  }
  if (
    !Array.isArray(rows) ||
    rows.some(
      (r) =>
        typeof r.codeId !== 'string' ||
        typeof r.codeNm !== 'string' ||
        r.upperDetailCode !== '01',
    )
  )
    throw new SourceError('CLASS_SCHEMA', '시설 분류 응답이 변경되었습니다.');
  return new Map(rows.map((r) => [r.codeId, text(r.codeNm)]));
}
export function parseDetail(body) {
  let d;
  try {
    d = JSON.parse(body);
  } catch {
    throw new SourceError('DETAIL_SCHEMA', '객실 상세 응답이 JSON이 아닙니다.');
  }
  if (!d || typeof d !== 'object' || !Array.isArray(d.listGoodsUnprc))
    throw new SourceError('DETAIL_SCHEMA', '객실 상세 응답이 변경되었습니다.');
  return d;
}
