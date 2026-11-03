import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true, index: true })
  conversationId: number;

  @Prop({ required: true })
  senderId: number;

  @Prop({ required: true })
  body: string;

  @Prop({ default: 'text' })
  type: string;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
