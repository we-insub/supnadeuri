'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';

type Status = 'missing' | 'unverified' | 'verified' | 'reconnect';
type Login = {
  login_window_open: boolean;
  login_busy: boolean;
  login_enabled: boolean;
  action_token: string;
};
const labels: Record<Status, string> = {
  missing: '처음이라면 본인 계정으로 로그인해 주세요',
  unverified: '로그인 정보 저장됨 · 빈방 검색으로 연결을 확인해 주세요',
  verified: '최근 숲나들e 조회 확인됨',
  reconnect: '로그인 재연결 필요 · 숲나들e에서 조회가 거절됐어요',
};
export function SessionSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [login, setLogin] = useState<Login | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const [health, state] = await Promise.all([
        fetch('/api/health', { cache: 'no-store', signal }),
        fetch('/api/session/status', { cache: 'no-store', signal }),
      ]);
      if (!health.ok || !state.ok)
        throw new Error(
          '연결 상태를 확인하지 못했습니다. 프로그램이 실행 중인지 확인해 주세요.',
        );
      const data = (await health.json()) as { auth_status: Status };
      setStatus(
        Object.hasOwn(labels, data.auth_status)
          ? data.auth_status
          : 'unverified',
      );
      setLogin(await state.json());
    } catch (e) {
      if (!signal?.aborted)
        setError(
          e instanceof Error ? e.message : '연결 상태를 확인하지 못했습니다.',
        );
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const update = () => {
      if (!controller.signal.aborted) void refresh(controller.signal);
    };
    void Promise.resolve().then(update);
    window.addEventListener('focus', update);
    window.addEventListener('foresttrip-search-finished', update);
    return () => {
      controller.abort();
      window.removeEventListener('focus', update);
      window.removeEventListener('foresttrip-search-finished', update);
    };
  }, [refresh]);
  useEffect(() => {
    if (!login?.login_window_open) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      void refresh(controller.signal);
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [login?.login_window_open, refresh]);
  async function action(kind: 'start' | 'finish' | 'cancel') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const state = await fetch('/api/session/status', { cache: 'no-store' });
      if (!state.ok) throw new Error('프로그램과 연결하지 못했습니다.');
      const { action_token } = (await state.json()) as Login;
      const response = await fetch('/api/session/' + kind, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Local-Login-Token': action_token,
        },
        body: '{}',
      });
      const result = (await response.json()) as { message?: string };
      if (!response.ok)
        throw new Error(result.message || '로그인 연결에 실패했습니다.');
      if (kind === 'finish') {
        setNotice(
          '본인 로그인 정보를 이 컴퓨터에 저장했습니다. 이제 빈방 찾기를 눌러 주세요.',
        );
        window.dispatchEvent(new Event('foresttrip-session-changed'));
      } else if (kind === 'start') {
        setNotice(
          '새 Chrome 창에서 로그인한 뒤, 이 화면으로 돌아와 로그인 완료·연결을 눌러 주세요.',
        );
      } else
        setNotice('연결을 취소했습니다. 기존 로그인 정보는 바뀌지 않았습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '로그인 연결에 실패했습니다.');
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  const waiting = login?.login_window_open;
  return (
    <Collapsible className="session-setup" open={open} onOpenChange={setOpen}>
      <div className="session-status">
        <output aria-live="polite">
          {status ? labels[status] : '로그인 상태 확인 중…'}
        </output>
        <CollapsibleTrigger className="session-toggle">
          {open ? '안내 닫기' : '로그인 도움말'}
        </CollapsibleTrigger>
      </div>
      <div className="session-actions">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !login?.login_enabled || login.login_busy}
          onClick={() => {
            void action('start');
          }}
        >
          {busy
            ? '처리 중…'
            : waiting
              ? '로그인 창 보기'
              : status === 'missing'
                ? '숲나들e 로그인'
                : '숲나들e 다시 로그인'}
        </Button>
        {waiting && (
          <>
            <Button
              type="button"
              disabled={busy || login?.login_busy}
              onClick={() => {
                void action('finish');
              }}
            >
              로그인 완료·연결
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy || login?.login_busy}
              onClick={() => {
                void action('cancel');
              }}
            >
              연결 취소
            </Button>
          </>
        )}
      </div>
      {notice && <output className="session-notice">{notice}</output>}
      {error && (
        <p role="alert" className="session-error">
          {error}
        </p>
      )}
      {login && !login.login_enabled && (
        <p className="session-error">
          별도 인증 경로가 설정되어 있습니다. 해당 설정을 해제하고 다시 실행하면
          로그인 버튼을 사용할 수 있습니다.
        </p>
      )}
      <CollapsibleContent className="session-guide">
        <h2>본인 계정으로 로그인하면 됩니다</h2>
        <ol>
          <li>
            <strong>숲나들e 로그인</strong>을 누르면 이 프로그램 전용 Chrome
            창이 열립니다.
          </li>
          <li>
            그 창의 공식 사이트에서 직접 로그인합니다. 본인인증이나 보안문자가
            나오면 직접 완료해 주세요.
          </li>
          <li>
            이 화면으로 돌아와 <strong>로그인 완료·연결</strong>을 누른 뒤
            빈방을 검색합니다.
          </li>
        </ol>
        <p>
          평소 사용하던 Chrome 창의 로그인과는 별개입니다. 파일 내보내기나
          프로그램 재시작은 필요 없습니다. Mac·Windows에 Chrome이 설치되어
          있어야 합니다.
        </p>
        <p>
          비밀번호를 이 화면에서 받지 않습니다. 연결에 동의해 버튼을 누르면 공식
          사이트의 로그인 정보만 본인 컴퓨터에 저장합니다. 연결 창은 완료·취소
          또는 10분 후 닫힙니다.
        </p>
        <p>
          저장됨은 현재 예약 조회의 성공을 보장하지 않습니다. 공식 사이트가
          접근을 제한하면 연결이 실패할 수 있으며, 제한을 우회하지 않습니다.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
