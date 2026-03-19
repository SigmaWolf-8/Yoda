import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getStoredToken } from '../client';
import type { PipelineEvent } from '../../types';

interface UsePipelineStatusOptions {
  projectId?: string;
  enabled?: boolean;
  onEvent?: (event: PipelineEvent) => void;
}

const MAX_RECONNECT_DELAY = 30_000;
const BASE_DELAY = 1_000;

export function usePipelineStatus({
  projectId,
  enabled = true,
  onEvent,
}: UsePipelineStatusOptions) {
  const qc = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<PipelineEvent | null>(null);

  const connect = useCallback(() => {
    if (!projectId || !enabled) return;

    const token = getStoredToken();
    if (!token) return;

    // Build WebSocket URL from current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/pipeline/${projectId}?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectAttempt.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const parsed: PipelineEvent = JSON.parse(event.data);
        setLastEvent(parsed);
        onEvent?.(parsed);

        // Update React Query caches based on event type
        switch (parsed.type) {
          case 'TaskStateChange':
          case 'TaskComplete':
            qc.invalidateQueries({ queryKey: ['tasks', projectId] });
            qc.invalidateQueries({ queryKey: ['task', parsed.task_id] });
            break;
          case 'PipelineComplete':
            qc.invalidateQueries({ queryKey: ['tasks', projectId] });
            qc.invalidateQueries({ queryKey: ['taskBible', projectId] });
            qc.invalidateQueries({ queryKey: ['kb', projectId] });
            break;
          case 'EngineHealthChange':
            qc.invalidateQueries({ queryKey: ['engines'] });
            break;
          // StepProgress, EngineActivity, ReviewComplete — no cache invalidation,
          // just forward to onEvent for UI updates
        }
      } catch {
        // Non-JSON message — ignore
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;

      // Exponential backoff reconnect
      if (enabled) {
        const delay = Math.min(
          BASE_DELAY * Math.pow(2, reconnectAttempt.current),
          MAX_RECONNECT_DELAY,
        );
        reconnectAttempt.current += 1;
        reconnectTimer.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror — reconnect happens there
      ws.close();
    };
  }, [projectId, enabled, onEvent, qc]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectTimer.current);
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  return { connected, lastEvent, disconnect };
}
