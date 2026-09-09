import nodeTest from 'node:test';
const test = (name, run) => { void nodeTest(name, run); };
import assert from 'node:assert/strict';
import {
  validateQuery,
  normalizeRoom,
  locationFor,
  officialURL,
  groupsFor,
} from '../normalize.mjs';
import { parseRooms, parseForests, parseClasses } from '../parsers.mjs';
import { Upstream } from '../upstream.mjs';

// Sanitized fields from the real 2026-09-09 two-night HTTP response.
// Deliberately mutated copies below test rejection; they are never served by the app.
const forest = {
  id: '0244',
  name: '검봉산 자연휴양림',
  address: '강원특별자치도 삼척시 원덕읍',
  url: 'http://www.foresttrip.go.kr/0244',
};
const query = {
  check_in: '2026-09-19',
  check_out: '2026-09-21',
  guests: 2,
  regions: ['강원'],
  nights: 2,
};
const detail = {
  insttId: '0244',
  goodsId: 'G02440100301003007900132',
  insttNm: '검봉산 자연휴양림',
  goodsNm: '[A동]고로쇠',
  mnmmAccptCnt: 8,
  mxmmAccptCnt: 8,
  rsrvtBgDt: '20260919',
  rsrvtEdDt: '20260921',
  sthngQnt: 2,
  upperGoodsClsscCd: '01',
  sumGoodsUnprc: 271000,
  addtnNofpr: 'N',
  listGoodsUnprc: [
    {
      insttId: '0244',
      goodsId: 'G02440100301003007900132',
      rsrvtDate: '20260919',
      upperGoodsClsscCd: '01',
      goodsClsCd: '01003',
      goodsUnprc: 173000,
    },
    {
      insttId: '0244',
      goodsId: 'G02440100301003007900132',
      rsrvtDate: '20260920',
      upperGoodsClsscCd: '01',
      goodsClsCd: '01003',
      goodsUnprc: 98000,
    },
  ],
};
const classes = new Map([['01003', '연립동']]);
const norm = (d) => normalizeRoom(forest, detail.goodsId, d, query, classes);
test('actual two-night total, same room, lodging classification', () => {
  const r = norm(detail);
  assert.equal(r.price, 271000);
  assert.equal(r.facility_type, '연립동');
  assert.equal(r.available, true);
  assert.equal(r.booking_url, 'https://www.foresttrip.go.kr/0244');
});
test('missing stay night is rejected', () =>
  assert.throws(() =>
    norm({ ...detail, listGoodsUnprc: detail.listGoodsUnprc.slice(1) }),
  ));
test('duplicate night is rejected', () =>
  assert.throws(() =>
    norm({
      ...detail,
      listGoodsUnprc: [detail.listGoodsUnprc[0], detail.listGoodsUnprc[0]],
    }),
  ));
test('different room on second night is rejected', () => {
  const d = structuredClone(detail);
  d.listGoodsUnprc[1].goodsId = 'different';
  assert.throws(() => norm(d));
});
test('sum mismatch is rejected', () =>
  assert.throws(() => norm({ ...detail, sumGoodsUnprc: 346000 })));
test('wrong dates, missing prices, changed type and unknown classes fail closed', () => {
  for (const patch of [
    { rsrvtEdDt: '20260920' },
    { sumGoodsUnprc: null },
    { sumGoodsUnprc: '271000' },
    { listGoodsUnprc: null },
  ])
    assert.throws(() => norm({ ...detail, ...patch }));
  assert.throws(() =>
    normalizeRoom(forest, detail.goodsId, detail, query, new Map()),
  );
});
test('camping is excluded', () =>
  assert.equal(norm({ ...detail, upperGoodsClsscCd: '02' }), null));
test('insufficient capacity excluded', () =>
  assert.equal(
    normalizeRoom(
      forest,
      detail.goodsId,
      detail,
      { ...query, guests: 9 },
      classes,
    ),
    null,
  ));
test('actual empty paging is valid, login and changed HTML are errors', () => {
  assert.deepEqual(
    parseRooms(
      '<div class="goods_list_area"><div class="communication_list"></div></div><span class="paging_count">(0/0)</span>',
    ),
    { ids: [], pages: 0, current: 0 },
  );
  for (const html of ['<html>로그인</html>', '<div class="list_box"></div>'])
    assert.throws(() => parseRooms(html));
});
test('room pagination validates requested page and duplicates', () => {
  const html =
    '<div class="communication_list"><div class="list_box"><a class="item" data-value="G02440100301003007900132"></a></div></div><span class="paging_count">(1/2)</span>';
  assert.equal(parseRooms(html).pages, 2);
  assert.throws(() => parseRooms(html, 2));
  assert.throws(() =>
    parseRooms(
      html.replace(
        '</a>',
        '</a><a class="item" data-value="G02440100301003007900132"></a>',
      ),
    ),
  );
});
test('changed regional HTML is not treated as empty inventory', () =>
  assert.throws(() => parseForests('<html>로그인</html>')));
test('classes parse known official codes and reject bad shape', () => {
  assert.equal(
    parseClasses(
      '[{"codeId":"01003","codeNm":"연립동","upperDetailCode":"01"}]',
    ).get('01003'),
    '연립동',
  );
  assert.throws(() => parseClasses('{}'));
});
test('official address override and exact province', () => {
  assert.deepEqual(
    locationFor({ id: 'ID04030004', address: '서울 동작구 현충로 75' }),
    { province: '경기', city: '양평군' },
  );
  assert.deepEqual(locationFor({ id: 'x', address: '인천광역시 강화군 길' }), {
    province: '인천',
    city: '강화군',
  });
  assert.throws(() => locationFor({ id: 'x', address: '' }));
});
test('current merged province is normalized without dropping 17 forests', () => {
  assert.deepEqual(
    locationFor({
      id: '0181',
      address: '전남광주통합특별시 장성군 북이면 방장로 353',
    }),
    { province: '전남·광주', city: '장성군' },
  );
  assert.deepEqual(groupsFor(['전남·광주']), ['6']);
});
test('official links cannot send users to other domains or leak queue keys', () => {
  assert.throws(() => officialURL('https://foresttrip.go.kr.attacker.test/'));
  assert.throws(() => officialURL('javascript:alert(1)'));
  assert.throws(() => officialURL('https://user@www.foresttrip.go.kr/'));
  assert.equal(
    officialURL(
      'https://www.foresttrip.go.kr/0244?_csrf=secret&netfunnel_key=secret',
    ),
    'https://www.foresttrip.go.kr/0244',
  );
});
test('date, guests and regions are validated before requesting upstream', () => {
  const now = new Date('2026-09-09T00:00:00Z');
  assert.equal(validateQuery(query, now).nights, 2);
  for (const patch of [
    { check_in: '2026-02-30' },
    { check_out: '2026-09-19' },
    { check_in: '2026-09-08' },
    { guests: 0 },
    { guests: 2.5 },
    { regions: ['unknown'] },
    { regions: '경기' },
  ])
    assert.throws(() => validateQuery({ ...query, ...patch }, now));
  assert.deepEqual(groupsFor(['경기', '강원']), ['1', '2']);
  assert.equal(groupsFor([]).length, 9);
});
const endpoint = '/rep/or/innerFcfsRcrfrDtlDetls.do';
function upstream(fetchImpl) {
  const u = new Upstream({ fetchImpl, interval: 0 });
  u.loadSession = async () => {
    u.session = { cookie: 'unit-test-only', csrf: 'unit-test-only' };
    return u.session;
  };
  return u;
}
test('401 is not retried', async () => {
  let calls = 0;
  const u = upstream(async () => {
    calls++;
    return new Response('', { status: 401 });
  });
  await assert.rejects(
    () => u.post(endpoint, {}),
    (e) => e.code === 'AUTH_REQUIRED',
  );
  assert.equal(calls, 1);
  assert.equal(u.authState, 'reconnect');
  await assert.rejects(() => u.post(endpoint, {}), { code: 'AUTH_REQUIRED' });
  assert.equal(calls, 1);
});
test('429 respects retry-after and stops subsequent requests', async () => {
  let calls = 0;
  const u = upstream(async () => {
    calls++;
    return new Response('', { status: 429, headers: { 'retry-after': '120' } });
  });
  await assert.rejects(() => u.post(endpoint, {}));
  assert.ok(u.blockedUntil > Date.now() + 119000);
  await assert.rejects(() => u.post(endpoint, {}));
  assert.equal(calls, 1);
});
test('request semaphore limits simultaneous upstream calls to three', async () => {
  let active = 0,
    max = 0;
  const u = upstream(async () => {
    max = Math.max(max, ++active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return new Response('ok');
  });
  await Promise.all(Array.from({ length: 12 }, () => u.post(endpoint, {})));
  assert.ok(max <= 3);
});
test('read-only endpoint allowlist excludes booking and arbitrary requests', async () => {
  const u = upstream(() => assert.fail('must not send'));
  await assert.rejects(() => u.post('/booking', {}));
});
