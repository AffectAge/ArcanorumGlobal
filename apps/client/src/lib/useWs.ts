import { useEffect, useRef } from "react";
import type { WsInMessage, WsOutMessage } from "@arcanorum/shared";
import { apiBase } from "./api";

export function useWs(onMessage: (msg: WsOutMessage) => void, token?: string | null) {
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!token) {
      wsRef.current?.close();
      wsRef.current = null;
      return;
    }

    const wsUrl = apiBase.replace("http", "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "AUTH", token } satisfies WsInMessage));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as WsOutMessage;
      onMessage(message);
    };

    return () => {
      ws.close();
    };
  }, [onMessage, token]);

  const send = (message: WsInMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(message));
  };

  return { send };
}
