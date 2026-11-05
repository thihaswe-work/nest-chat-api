/**
 * LEGACY PLACEHOLDER - not the real message shape.
 *
 * The real MongoDB schema lives in ./schemas/message.schema.ts. This empty class
 * previously served as the injection token for Mongoose's @InjectModel(); that
 * import now points at the schema directly.
 *
 * Nothing imports this file. It is kept only to avoid breaking any external
 * code that still imports it; delete it once you have confirmed no consumers.
 */
export class Message {}
