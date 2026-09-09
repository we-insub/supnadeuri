'use client';
/* eslint-disable next/no-img-element -- Official images stay direct, lazy-loaded and unproxied. */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Trees,
  Search,
  ArrowUpRight,
  MapPin,
  Users,
  CircleCheck,
  LoaderCircle,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { groupRoomsByForest } from './room-groups.mjs';
import { SessionSetup } from './session-setup';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';

const provinces = [
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
];
type Room = {
  forest_id: string;
  forest_name: string;
  province: string;
  city: string;
  facility_type: string;
  room_id: string;
  room_name: string;
  capacity: number;
  max_capacity: number;
  price: number;
  available: boolean;
  booking_url: string;
  image_url?: string;
  price_note?: string;
  check_in: string;
  check_out: string;
};
type SearchResult = {
  rooms: Room[];
  checked_at: string;
  cached: boolean;
  complete: boolean;
  forests_checked: number;
  forests_total: number;
  warnings: string[];
  query: {
    check_in: string;
    check_out: string;
    guests: number;
    regions: string[];
  };
};
type SearchInput = SearchResult['query'];
function Choice({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: string[];
  onChange: (s: string) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger aria-label={label}>
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function Home() {
  const [checkIn, setCheckIn] = useState('2026-09-19');
  const [checkOut, setCheckOut] = useState('2026-09-20');
  const [guests, setGuests] = useState('2');
  const [regions, setRegions] = useState<string[]>(['경기', '강원']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [facility, setFacility] = useState('전체');
  const [sort, setSort] = useState('기본');
  const [resultRegion, setResultRegion] = useState('전체 지역');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  const rooms = useMemo(() => {
    const r = (result?.rooms || []).filter(
      (r) =>
        (facility === '전체' || r.facility_type === facility) &&
        (resultRegion === '전체 지역' || r.province === resultRegion) &&
        (!minimum || r.price >= Number(minimum)) &&
        (!maximum || r.price <= Number(maximum)),
    );
    return sort === '기본'
      ? r
      : r.sort((a, b) =>
          sort === '가격 낮은 순' ? a.price - b.price : b.price - a.price,
        );
  }, [result, facility, sort, resultRegion, minimum, maximum]);
  const forests = useMemo(() => groupRoomsByForest(rooms), [rooms]);
  async function search(input?: SearchInput) {
    const q = input || {
      check_in: checkIn,
      check_out: checkOut,
      guests: Number(guests),
      regions,
    };
    if (
      !q.check_in ||
      !q.check_out ||
      q.check_out <= q.check_in ||
      !Number.isInteger(q.guests) ||
      q.guests < 1 ||
      !Array.isArray(q.regions) ||
      q.regions.some((r) => !provinces.includes(r))
    ) {
      setError(
        '날짜와 인원을 확인해 주세요. 체크아웃은 체크인 다음 날부터 선택할 수 있습니다.',
      );
      return;
    }
    if (input) {
      setCheckIn(q.check_in);
      setCheckOut(q.check_out);
      setGuests(String(q.guests));
      setRegions(q.regions);
    }
    requestRef.current?.abort();
    const ctrl = new AbortController();
    requestRef.current = ctrl;
    setBusy(true);
    setError('');
    setResult(null);
    setResultRegion('전체 지역');
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(q),
        signal: ctrl.signal,
      });
      const data = (await response.json()) as SearchResult & {
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          data.message || '조회하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        );
      setResult(data);
      return data;
    } catch (e) {
      if (!ctrl.signal.aborted)
        setError(
          e instanceof Error ? e.message : '조회 중 연결이 끊어졌습니다.',
        );
    } finally {
      if (requestRef.current === ctrl) setBusy(false);
      window.dispatchEvent(new Event('foresttrip-search-finished'));
    }
  }
  useEffect(() => {
    const clearPrevious = () => {
      setResult(null);
      setError('');
    };
    window.addEventListener('foresttrip-session-changed', clearPrevious);
    return () =>
      window.removeEventListener('foresttrip-session-changed', clearPrevious);
  }, []);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  });
  useEffect(() => {
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'search_available_forest_rooms',
            title: '자연휴양림 빈방 검색',
            description:
              '날짜, 지역, 인원으로 실제 객실을 조회하고 화면의 검색 결과를 갱신합니다. 예약하지 않습니다.',
            inputSchema: {
              type: 'object',
              properties: {
                check_in: { type: 'string', format: 'date' },
                check_out: { type: 'string', format: 'date' },
                guests: { type: 'integer', minimum: 1, maximum: 100 },
                regions: {
                  type: 'array',
                  items: { type: 'string', enum: provinces },
                },
              },
              required: ['check_in', 'check_out', 'guests', 'regions'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: true },
            async execute(input: unknown) {
              if (!input || typeof input !== 'object')
                throw new Error('검색 조건이 필요합니다.');
              const q = input as SearchInput;
              if (
                typeof q.check_in !== 'string' ||
                typeof q.check_out !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}$/.test(q.check_in) ||
                !/^\d{4}-\d{2}-\d{2}$/.test(q.check_out) ||
                q.check_out <= q.check_in ||
                !Number.isInteger(q.guests) ||
                q.guests < 1 ||
                q.guests > 100 ||
                !Array.isArray(q.regions) ||
                q.regions.some((r) => !provinces.includes(r))
              )
                throw new Error('검색 조건이 올바르지 않습니다.');
              const data = await searchRef.current(q);
              if (!data)
                throw new Error(
                  '조회에 실패했습니다. 화면의 오류 안내를 확인해 주세요.',
                );
              return {
                count: data.rooms.length,
                complete: data.complete,
                checked_at: data.checked_at,
                warnings: data.warnings,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => console.warn('검색 도구 등록 불가'));
    } catch {
      console.warn('검색 도구 지원 안 함');
    }
    return () => lifecycle.abort();
  }, []);
  return (
    <>
      <header className="site-header">
        <div className="brand">
          <Trees aria-hidden="true" />
          <span>숲 빈방</span>
        </div>
        <a
          href="https://www.foresttrip.go.kr/main.do"
          target="_blank"
          rel="noopener noreferrer"
        >
          숲나들e 공식 사이트 <ArrowUpRight size={16} />
        </a>
      </header>
      <main>
        <section className="search-section" aria-labelledby="title">
          <p className="eyebrow">자연 속에서 보내는 하룻밤</p>
          <h1 id="title">
            전국 자연휴양림
            <br className="mobile-break" /> 빈방 찾기
          </h1>
          <p className="intro">
            날짜와 지역, 인원을 정하면 예약 가능한 객실을 모아 보여드려요.
          </p>
          <SessionSetup />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
            className="search-panel"
          >
            <div className="date-row">
              <label htmlFor="check-in">
                체크인
                <Input
                  id="check-in"
                  type="date"
                  required
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              </label>
              <span className="date-arrow" aria-hidden="true">
                →
              </span>
              <label htmlFor="check-out">
                체크아웃
                <Input
                  id="check-out"
                  type="date"
                  required
                  min={checkIn}
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </label>
              <label className="guest-input" htmlFor="guests">
                인원
                <Input
                  id="guests"
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                  aria-label="숙박 인원"
                />
              </label>
            </div>
            <fieldset>
              <legend>
                지역 <span>여러 지역을 함께 선택할 수 있어요</span>
              </legend>
              <div className="region-options">
                <label
                  htmlFor="region-all"
                  className={regions.length === 0 ? 'selected' : ''}
                >
                  <Checkbox
                    id="region-all"
                    aria-label="전국"
                    checked={regions.length === 0}
                    onCheckedChange={() => setRegions([])}
                  />
                  전국
                </label>
                {provinces.map((p) => (
                  <label
                    key={p}
                    htmlFor={'region-' + p}
                    className={regions.includes(p) ? 'selected' : ''}
                  >
                    <Checkbox
                      id={'region-' + p}
                      aria-label={p}
                      checked={regions.includes(p)}
                      onCheckedChange={(v) =>
                        setRegions((prev) =>
                          v ? [...prev, p] : prev.filter((x) => x !== p),
                        )
                      }
                    />
                    {p}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="search-bottom">
              <p>
                <CircleCheck size={16} /> 예약 가능한 숙박시설만 조회합니다
              </p>
              <Button type="submit" disabled={busy} className="search-button">
                {busy ? <LoaderCircle className="spin" /> : <Search />}
                {busy ? '빈방 확인 중' : '빈방 찾기'}
              </Button>
            </div>
          </form>
        </section>
        <section className="results" aria-label="검색 결과" aria-busy={busy}>
          {error && (
            <div role="alert" className="error">
              <strong>조회가 완료되지 않았습니다</strong>
              <p>{error}</p>
              <p>조회 실패는 예약 가능한 객실이 없다는 뜻이 아닙니다.</p>
            </div>
          )}
          {busy && (
            <Empty className="waiting">
              <LoaderCircle className="spin" size={28} />
              <EmptyHeader>
                <EmptyTitle>휴양림의 실제 빈방을 확인하고 있어요</EmptyTitle>
                <EmptyDescription>
                  조회 대상이 많으면 몇 분 정도 걸릴 수 있습니다.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {!busy && !result && !error && (
            <Empty className="initial">
              <Trees size={32} />
              <EmptyHeader>
                <EmptyTitle>이번 여행, 숲에서 쉬어갈까요?</EmptyTitle>
                <EmptyDescription>
                  위에서 원하는 조건을 선택하고 빈방을 찾아보세요.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {result && (
            <>
              <div className="results-heading">
                <div>
                  <p>
                    {result.query.check_in} — {result.query.check_out} ·{' '}
                    {result.query.guests}명
                  </p>
                  <h2>
                    {result.complete ? '예약 가능한' : '확인된 예약 가능'} 객실{' '}
                    <em>{result.rooms.length}</em>개
                  </h2>
                </div>
                <span>
                  {new Date(result.checked_at).toLocaleTimeString('ko-KR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'Asia/Seoul',
                  })}{' '}
                  확인{result.cached ? ' · 캐시' : ''}
                </span>
              </div>
              {!result.complete && (
                <output className="notice">
                  일부 휴양림을 확인하지 못했습니다. 전체 조회 결과가 아닙니다.
                  {result.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </output>
              )}
              <div className="filter-bar">
                <SlidersHorizontal size={18} aria-hidden="true" />
                <Choice
                  label="시설 유형"
                  value={facility}
                  items={['전체', '숲속의집', '휴양관', '연립동', '기타']}
                  onChange={setFacility}
                />
                <Choice
                  label="결과 지역"
                  value={resultRegion}
                  items={[
                    '전체 지역',
                    ...new Set(result.rooms.map((r) => r.province)),
                  ]}
                  onChange={setResultRegion}
                />
                <div className="price-filter">
                  <Input
                    type="number"
                    min="0"
                    placeholder="최저 가격"
                    aria-label="최저 가격"
                    value={minimum}
                    onChange={(e) => setMinimum(e.target.value)}
                  />
                  <span>~</span>
                  <Input
                    type="number"
                    min="0"
                    placeholder="최고 가격"
                    aria-label="최고 가격"
                    value={maximum}
                    onChange={(e) => setMaximum(e.target.value)}
                  />
                  <span>원</span>
                </div>
                <Choice
                  label="정렬"
                  value={sort}
                  items={['기본', '가격 낮은 순', '가격 높은 순']}
                  onChange={setSort}
                />
              </div>
              <p className="result-note">
                {result.forests_checked}/{result.forests_total}개 휴양시설 조회
                · 조건에 맞는 휴양림 {forests.length}곳 / 객실 {rooms.length}개
                · 가격은 전체 숙박기간 합계입니다.
              </p>
              <div className="forest-list">
                {forests.map(
                  ({ forest, rooms: options, min_price, max_price }) => (
                    <article
                      className="forest-card"
                      key={forest.forest_id}
                      aria-labelledby={'forest-' + forest.forest_id}
                    >
                      <div className="forest-header">
                        {forest.image_url && (
                          <img
                            className="forest-image"
                            src={forest.image_url}
                            alt={forest.forest_name + ' 전경'}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        )}
                        <div className="forest-summary">
                          <p className="location">
                            <MapPin size={14} />
                            {forest.province} {forest.city}
                          </p>
                          <h3 id={'forest-' + forest.forest_id}>
                            {forest.forest_name}
                          </h3>
                          <p className="available">
                            <CircleCheck size={14} aria-hidden="true" />
                            예약 가능한 객실 {options.length}개
                          </p>
                          <p className="forest-price-range">
                            {min_price.toLocaleString('ko-KR')}원
                            {max_price !== min_price &&
                              ` ~ ${max_price.toLocaleString('ko-KR')}원`}
                            <span> · 전체 숙박기간</span>
                          </p>
                        </div>
                      </div>
                      <ul
                        className="room-options"
                        aria-label={forest.forest_name + ' 예약 가능한 객실'}
                      >
                        {options.map((r) => (
                          <li className="room-option" key={r.room_id}>
                            <div className="room-details">
                              <p className="room-type">{r.facility_type}</p>
                              <h4>{r.room_name}</h4>
                              <p className="capacity">
                                <Users size={16} aria-hidden="true" />
                                기준 {r.capacity}명 / 최대 {r.max_capacity}명
                              </p>
                              {r.price_note && (
                                <p className="price-note">{r.price_note}</p>
                              )}
                            </div>
                            <div className="room-action">
                              <div className="room-pricing">
                                <strong className="room-price">
                                  {r.price.toLocaleString('ko-KR')}
                                  <small>원</small>
                                </strong>
                                <dl className="room-stay-dates">
                                  <div>
                                    <dt>체크인</dt>
                                    <dd>
                                      <time dateTime={r.check_in}>
                                        {r.check_in}
                                      </time>
                                    </dd>
                                  </div>
                                  <div>
                                    <dt>체크아웃</dt>
                                    <dd>
                                      <time dateTime={r.check_out}>
                                        {r.check_out}
                                      </time>
                                    </dd>
                                  </div>
                                </dl>
                              </div>
                              <a
                                className="book-link"
                                href={r.booking_url}
                                aria-label={
                                  r.forest_name +
                                  ' ' +
                                  r.room_name +
                                  ' 숲나들e에서 예약'
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                referrerPolicy="no-referrer"
                              >
                                예약하러 가기{' '}
                                <ArrowUpRight size={17} aria-hidden="true" />
                              </a>
                            </div>
                          </li>
                        ))}
                      </ul>
                      <p className="booking-note">
                        숲나들e 공식 페이지에서 날짜와 객실을 선택해 예약해
                        주세요.
                      </p>
                    </article>
                  ),
                )}
              </div>
              {rooms.length === 0 && (
                <Empty className="initial">
                  <EmptyHeader>
                    <EmptyTitle>
                      {result.rooms.length
                        ? '필터 조건에 맞는 객실이 없습니다.'
                        : result.complete
                          ? '이 기간에 예약 가능한 객실이 없습니다.'
                          : '조회한 범위에서 빈방을 찾지 못했습니다.'}
                    </EmptyTitle>
                    <EmptyDescription>
                      날짜나 지역, 인원 조건을 바꿔 다시 검색해 보세요.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </>
          )}
        </section>
        <footer>
          숲나들e의 실제 조회 정보를 제공합니다. 예약 가능 여부와 요금은 변경될
          수 있으며, 최종 예약은 공식 사이트에서 확인해 주세요.
          <br />
          숲나들e가 운영하는 공식 서비스가 아닙니다. 예약·결제는 대행하지
          않습니다.
          <br />
          공식 예약페이지가 열리지 않으면 Chrome에서 이용해 주세요.
        </footer>
      </main>
    </>
  );
}
