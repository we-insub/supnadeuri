import { SourceError } from './errors.mjs';
export const PROVINCES = [
  '경기',
  '강원',
  '충북',
  '충남',
  '경북',
  '경남',
  '전북',
  '전남·광주',
  '제주',
  '서울',
  '인천',
  '대전',
  '세종',
  '대구',
  '부산',
  '울산',
  '전남',
  '광주',
];
const groupMap = {
  경기: '1',
  서울: '1',
  인천: '1',
  강원: '2',
  충북: '3',
  충남: '4',
  대전: '4',
  전북: '5',
  전남: '6',
  광주: '6',
  경북: '7',
  대구: '7',
  경남: '8',
  부산: '8',
  제주: '9',
};
export const ALL_GROUPS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
groupMap['전남·광주'] = '6';
export function groupsFor(regions) {
  return !regions.length || regions.some((r) => !groupMap[r])
    ? ALL_GROUPS
    : [...new Set(regions.map((r) => groupMap[r]))].sort((a,b)=>a.localeCompare(b));
}
export function validateQuery(input, now = new Date()) {
  if (!input || typeof input !== 'object')
    throw new SourceError('INVALID_QUERY', '검색 조건을 확인해 주세요.', 400);
  const { check_in, check_out, guests, regions = [] } = input;
  const validDate = (s) =>
    typeof s === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  const today = new Date(now.getTime() + 9 * 3600000)
    .toISOString()
    .slice(0, 10);
  if (
    !validDate(check_in) ||
    !validDate(check_out) ||
    check_out <= check_in ||
    check_in < today
  )
    throw new SourceError(
      'INVALID_DATE',
      '체크인은 오늘 이후, 체크아웃은 체크인 다음 날 이후로 선택해 주세요.',
      400,
    );
  const nights = (Date.parse(check_out) - Date.parse(check_in)) / 86400000;
  if (nights > 30 || Date.parse(check_in) > now.getTime() + 366 * 86400000)
    throw new SourceError(
      'DATE_RANGE',
      '한 번에 최대 30박, 1년 이내 날짜를 조회할 수 있습니다.',
      400,
    );
  if (!Number.isInteger(guests) || guests < 1 || guests > 100)
    throw new SourceError(
      'INVALID_GUESTS',
      '인원은 1~100명의 정수로 입력해 주세요.',
      400,
    );
  if (
    !Array.isArray(regions) ||
    regions.length > 17 ||
    regions.some((r) => !PROVINCES.includes(r))
  )
    throw new SourceError('INVALID_REGION', '지역을 다시 선택해 주세요.', 400);
  return {
    check_in,
    check_out,
    guests,
    regions: [
      ...new Set(
        regions.map((r) => (r === '전남' || r === '광주' ? '전남·광주' : r)),
      ),
      ].sort((a,b)=>a.localeCompare(b)),
    nights,
  };
}
export function requestFields(q, forestId = '') {
  return {
    srchInsttId: forestId,
    srchRsrvtBgDt: q.check_in.replaceAll('-', ''),
    srchRsrvtEdDt: q.check_out.replaceAll('-', ''),
    srchStngNofpr: String(q.guests),
    srchSthngCnt: q.nights,
  };
}
const aliases = {
  서울: '서울',
  서울특별시: '서울',
  인천: '인천',
  인천광역시: '인천',
  경기: '경기',
  경기도: '경기',
  강원: '강원',
  강원도: '강원',
  강원특별자치도: '강원',
  충북: '충북',
  충청북도: '충북',
  충남: '충남',
  충청남도: '충남',
  전북: '전북',
  전라북도: '전북',
  전북특별자치도: '전북',
  전남: '전남',
  전라남도: '전남',
  경북: '경북',
  경상북도: '경북',
  경남: '경남',
  경상남도: '경남',
  제주: '제주',
  제주도: '제주',
  제주특별자치도: '제주',
  부산: '부산',
  부산광역시: '부산',
  대구: '대구',
  대구광역시: '대구',
  대전: '대전',
  대전광역시: '대전',
  울산: '울산',
  울산광역시: '울산',
  광주: '광주',
  광주광역시: '광주',
  세종: '세종',
  세종특별자치시: '세종',
};
// The regional source lists this forest's Seoul office, not the accommodation.
// Verified 2026-09-09 from https://snrf.foresttrip.go.kr meta description.
const locationOverrides = { ID04030004: { province: '경기', city: '양평군' } };
export function locationFor(forest) {
  if (locationOverrides[forest.id]) return locationOverrides[forest.id];
  const parts = forest.address.trim().split(/\s+/);
  const rawProvince = aliases[parts[0]];
  // Current official source uses 전남광주통합특별시. Preserve its unified region.
  const province =
    parts[0] === '전남광주통합특별시' ||
    rawProvince === '전남' ||
    rawProvince === '광주'
      ? '전남·광주'
      : rawProvince;
  const city =
    parts[1]?.match(/^([가-힣]+[시군구])/)?.[1] ||
    (province === '세종' ? '세종시' : '');
  if (!province || !city)
    throw new SourceError(
      'LOCATION_SCHEMA',
      '휴양림 소재지 정보를 확인하지 못했습니다.',
    );
  return { province, city };
}
export function officialURL(raw) {
  try {
    const u = new URL(raw);
    if (
      (u.hostname === 'foresttrip.go.kr' ||
        u.hostname.endsWith('.foresttrip.go.kr')) &&
      ['http:', 'https:'].includes(u.protocol) &&
      !u.username &&
      !u.password
    ) {
      u.protocol = 'https:';
      // eslint-disable-next-line unicorn/no-useless-spread -- Snapshot before deleting; live iterator would skip adjacent keys.
      for (const key of [...u.searchParams.keys()])
        if (/csrf|netfunnel|token/i.test(key)) u.searchParams.delete(key);
      return u.href;
    }
  } catch {}
  throw new SourceError(
    'BOOKING_URL',
    '공식 예약 연결 주소를 확인하지 못했습니다.',
  );
}
function integer(value, name) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new SourceError('DETAIL_SCHEMA', name + ' 값이 변경되었습니다.');
  return value;
}
export function normalizeRoom(forest, roomId, d, q, classes) {
  const req = requestFields(q, forest.id);
  const fail = (message) => {
    throw new SourceError('DETAIL_SCHEMA', message);
  };
  if (
    d?.insttId !== forest.id ||
    d.goodsId !== roomId ||
    d.rsrvtBgDt !== req.srchRsrvtBgDt ||
    d.rsrvtEdDt !== req.srchRsrvtEdDt ||
    d.sthngQnt !== q.nights
  )
    fail('객실 또는 숙박기간이 조회 조건과 다릅니다.');
  if (d.upperGoodsClsscCd !== '01') return null;
  const capacity = integer(d.mnmmAccptCnt, '기준 인원'),
    max = integer(d.mxmmAccptCnt, '최대 인원');
  if (capacity < 1 || max < capacity) fail('정원 정보가 올바르지 않습니다.');
  if (max < q.guests) return null;
  if (!Array.isArray(d.listGoodsUnprc) || d.listGoodsUnprc.length !== q.nights)
    fail('숙박일별 요금이 누락되었습니다.');
  const days = Array.from({ length: q.nights }, (_, i) =>
    new Date(Date.parse(q.check_in) + i * 86400000)
      .toISOString()
      .slice(0, 10)
      .replaceAll('-', ''),
  );
  const prices = [...d.listGoodsUnprc].sort((a, b) =>
    String(a.rsrvtDate).localeCompare(String(b.rsrvtDate)),
  );
  if (
    prices.some(
      (p, i) =>
        p.rsrvtDate !== days[i] ||
        p.insttId !== forest.id ||
        p.goodsId !== roomId ||
        p.upperGoodsClsscCd !== '01',
    )
  )
    fail('전체 숙박일의 동일 객실을 확인하지 못했습니다.');
  const price = integer(d.sumGoodsUnprc, '합계');
  if (
    prices.reduce((s, p) => s + integer(p.goodsUnprc, '일별 요금'), 0) !== price
  )
    fail('날짜별 요금과 전체 합계가 다릅니다.');
  const types = new Set(prices.map((p) => classes.get(p.goodsClsCd)));
  if (types.size !== 1 || types.has(undefined))
    fail('숙박시설 분류를 확인하지 못했습니다.');
  const rawType = [...types][0];
  const type = ['숲속의집', '휴양관', '연립동'].includes(rawType)
    ? rawType
    : '기타';
  if (
    typeof d.goodsNm !== 'string' ||
    !d.goodsNm.trim() ||
    typeof d.insttNm !== 'string' ||
    !d.insttNm.trim()
  )
    fail('객실 이름이 누락되었습니다.');
  return {
    forest_id: forest.id,
    forest_name: d.insttNm,
    ...locationFor(forest),
    facility_type: type,
    room_id: roomId,
    room_name: d.goodsNm,
    capacity,
    max_capacity: max,
    price,
    check_in: q.check_in,
    check_out: q.check_out,
    available: true,
    booking_url: officialURL(forest.url || d.url),
    image_url: forest.image,
    nightly_prices: prices.map((p) => ({
      date: p.rsrvtDate,
      price: p.goodsUnprc,
    })),
    price_note:
      d.addtnNofpr === 'Y'
        ? '기준 인원 요금 · 기준 인원 초과 시 추가요금 별도 (공식 사이트 확인)'
        : '',
  };
}
