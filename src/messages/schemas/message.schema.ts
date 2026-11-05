import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * MongoDB document shape for chat messages.
 *
 * Mongo is used for messages because they are high-volume, append-only, and
 * naturally document-shaped (no joins needed to read a conversation). The
 * "messages" collection is derived from the class name.
 *
 * A MessageDocument is the hydrated Mongoose document type: it has all Message
 * fields plus document methods such as save() and toObject(). Typing the
 * injected model as Model<MessageDocument> gives editors full autocomplete.
 *
 * @Schema({ timestamps: true }) automatically adds and maintains createdAt and
 * updatedAt fields for every document.
 */
export type MessageDocument = HydratedDocument<Message>;

@Schema({ timestamps: true })
export class Message {
  /**
   * Conversation this message belongs to.
   *
   * This is the PostgreSQL ConversationEntity.id, but there is no cross-database
   * foreign key (Mongo cannot enforce one). Treat it as an application-level
   * reference.
   *
   * index: true creates a MongoDB index, which keeps "fetch messages for one
   * conversation" fast as the collection grows.
   */
  @Prop({ required: true, index: true })
  conversationId: number;

  // The PostgreSQL UserEntity.id of the author. Also an app-level reference.
  @Prop({ required: true })
  senderId: number;

  // The text content shown to clients.
  @Prop({ required: true })
  body: string;

  // Discriminator for future content types (e.g. "image", "system").
  @Prop({ default: 'text' })
  type: string;

  // Added automatically by the schema's timestamps option.
  createdAt: Date;
  updatedAt: Date;
}

// SchemaFactory turns the decorated class into a Mongoose Schema, which is what
// MongooseModule.forFeature() needs.
export const MessageSchema = SchemaFactory.createForClass(Message);
