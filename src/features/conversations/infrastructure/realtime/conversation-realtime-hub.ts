import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import WebSocket, { WebSocketServer } from 'ws';

import { AdminAuthService } from '../../../auth/application/services/admin-auth.service.js';
import { logger } from '../../../../shared/config/logger.js';

const websocketPath = '/ws/conversations';
const applicationProtocol = 'tktours-admin-v1';
const tokenProtocolPrefix = 'auth.';

type ConversationRealtimeEventType =
  | 'conversation.message.received'
  | 'conversation.updated'
  | 'conversation.control.changed'
  | 'conversation.read.changed'
  | 'concierge.processing'
  | 'concierge.replied'
  | 'concierge.failed';

export type ConversationRealtimeEvent = {
  type: ConversationRealtimeEventType;
  conversationId: string;
  messageId?: string;
  error?: string;
};

type ConnectedClient = WebSocket & { isAlive: boolean };

function parseProtocols(request: IncomingMessage): string[] {
  const header = request.headers['sec-websocket-protocol'];
  if (typeof header !== 'string') return [];
  return header.split(',').map((protocol) => protocol.trim()).filter(Boolean);
}

function rejectUpgrade(socket: Duplex, statusCode: number, statusText: string): void {
  socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export class ConversationRealtimeHub {
  private readonly adminAuthService = new AdminAuthService();
  private readonly websocketServer = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(applicationProtocol) ? applicationProtocol : false),
  });
  private readonly clients = new Set<ConnectedClient>();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private attached = false;

  attach(server: HttpServer): void {
    if (this.attached) return;
    this.attached = true;

    server.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.terminate();
          this.clients.delete(client);
          continue;
        }

        client.isAlive = false;
        client.ping();
      }
    }, 30_000);
    this.heartbeatTimer.unref();
  }

  publish(event: ConversationRealtimeEvent): void {
    const payload = JSON.stringify({ ...event, occurredAt: new Date().toISOString() });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  close(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const client of this.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.clients.clear();
    this.websocketServer.close();
  }

  private async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (requestUrl.pathname !== websocketPath) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    const protocols = parseProtocols(request);
    const tokenProtocol = protocols.find((protocol) => protocol.startsWith(tokenProtocolPrefix));
    const accessToken = tokenProtocol?.slice(tokenProtocolPrefix.length).trim();
    if (!protocols.includes(applicationProtocol) || !accessToken) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }

    try {
      const admin = await this.adminAuthService.getAuthenticatedAdmin(accessToken);
      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        const client = websocket as ConnectedClient;
        client.isAlive = true;
        this.clients.add(client);

        client.on('pong', () => {
          client.isAlive = true;
        });
        client.on('close', () => {
          this.clients.delete(client);
        });
        client.on('error', (error) => {
          logger.warn({ err: error, adminId: admin.id }, 'conversation websocket client error');
        });
        client.send(JSON.stringify({
          type: 'realtime.connected',
          occurredAt: new Date().toISOString(),
        }));
      });
    } catch (error) {
      logger.warn({ err: error }, 'conversation websocket authentication failed');
      rejectUpgrade(socket, 401, 'Unauthorized');
    }
  }
}

export const conversationRealtimeHub = new ConversationRealtimeHub();
