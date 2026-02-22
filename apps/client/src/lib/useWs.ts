import { useEffect, useRef } from "react";
import type { WsInMessage, WsOutMessage } from "@arcanorum/shared";
import { apiBase } from "./api";

export function useWs(onMessage: (msg: WsOutMessage) => void, token?: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const authedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      wsRef.current?.close();
      wsRef.current = null;
      authedTokenRef.current = null;
      return;
    }

    const wsUrl = apiBase.replace("http", "ws") + "/ws";
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "AUTH", token } satisfies WsInMessage));
      authedTokenRef.current = token;
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data) as WsOutMessage;
      onMessage(message);
    };

    return () => {
      ws.close();
      authedTokenRef.current = null;
    };
  }, [onMessage, token]);

  const send = (message: WsInMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !token) {
      return;
    }

    if (authedTokenRef.current !== token) {
      ws.send(JSON.stringify({ type: "AUTH", token } satisfies WsInMessage));
      authedTokenRef.current = token;
    }
    ws.send(JSON.stringify(message));
  };

  return { send };
}
