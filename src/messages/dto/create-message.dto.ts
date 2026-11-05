/**
 * Request body for POST /messages.
 *
 * The REST message routes are scaffolding; the working write path is the
 * WebSocket "message:send" event in chat.gateway.ts. If you implement the REST
 * path, add the same fields the gateway uses:
 *
 *   conversationId: number;
 *   senderId: number;
 *   body: string;
 *
 * Validation decorators (class-validator) plus ValidationPipe in main.ts would
 * enforce them.
 */
export class CreateMessageDto {}
