'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';

export function SessionSetup() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch('/api/health', {
        cache: 'no-store',
        signal,
      });
      if (!response.ok)
        throw new Error(
          '인증 상태를 확인하지 못했습니다. 로컬 실행 창이 켜져 있는지 확인해 주세요.',
        );
      const data = (await response.json()) as { session_configured?: unknown };
      if (typeof data.session_configured !== 'boolean')
        throw new Error('인증 상태 응답을 확인하지 못했습니다.');
      setConfigured(data.session_configured);
      setError('');
      if (!data.session_configured) setOpen(true);
    } catch (e) {
      if (!signal?.aborted)
        setError(
          e instanceof Error ? e.message : '인증 상태를 확인하지 못했습니다.',
        );
    } finally {
      if (!signal?.aborted) setChecking(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) return refresh(controller.signal);
    });
    return () => controller.abort();
  }, [refresh]);
  return (
    <Collapsible className="session-setup" open={open} onOpenChange={setOpen}>
      <div className="session-status">
        <output>
          {error
            ? '이 컴퓨터의 인증 확인 필요'
            : configured === null
              ? '이 컴퓨터의 인증 확인 중'
              : configured
                ? '이 컴퓨터에 인증 파일이 연결되어 있어요'
                : '처음 사용한다면 본인 인증을 연결해 주세요'}
        </output>
        <CollapsibleTrigger className="session-toggle">
          {open ? '안내 닫기' : '인증 연결 안내'}
        </CollapsibleTrigger>
      </div>
      {error && (
        <p role="alert" className="session-error">
          {error}
        </p>
      )}
      <CollapsibleContent className="session-guide">
        <h2>본인 컴퓨터에서, 본인 계정으로</h2>
        <ol>
          <li>
            <a
              href="https://www.foresttrip.go.kr/com/login.do"
              target="_blank"
              rel="noopener noreferrer"
            >
              숲나들e 공식 사이트에 로그인
            </a>
            합니다.
          </li>
          <li>
            README의 안내에 따라 본인의 로그인 메인 요청 1건을 인증 파일(HAR)로
            저장합니다. 로그인만으로 자동 연결되지는 않습니다.
          </li>
          <li>
            실행 중인 숲 빈방 창을 종료한 뒤, 내려받은 폴더의{' '}
            <strong>숲빈방 인증 연결</strong> 파일을 실행합니다. Mac은{' '}
            <code>.command</code>, Windows는 <code>.cmd</code>를 사용해 본인의
            HAR 파일을 연결합니다.
          </li>
          <li>
            운영체제에 맞는 <strong>숲빈방 실행</strong> 파일을 다시 실행하고
            날짜·지역·인원으로 검색합니다.
          </li>
        </ol>
        <p>
          인증은 이 컴퓨터에만 저장됩니다. 파일·쿠키·비밀번호를 다른 사람에게
          보내지 마세요. 연결 여부는 파일 확인 결과이며, 세션이 만료되었다면
          다시 로그인하고 연결해야 합니다.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            setError('');
            void refresh();
          }}
        >
          {checking ? '확인 중…' : '연결 상태 다시 확인'}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
