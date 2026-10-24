import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { ClientSession } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import type {
  QrMapping,
  QrMappingStorePort,
  QrTargetType,
} from '../../application/qr/qr-mapping-store.port';
import { QR_MAPPING_MODEL } from './qr-mapping.schema';

interface Query<T> {
  session(session: ClientSession): Query<T>;
  lean(): { exec(): Promise<T> };
  exec(): Promise<T>;
}
interface Model<T> {
  findOne(filter: Record<string, unknown>): Query<T | null>;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: Record<string, unknown>,
  ): Query<T | null>;
  create(
    documents: Record<string, unknown>[],
    options: Record<string, unknown>,
  ): Promise<unknown>;
}
interface Document {
  id: string;
  value: string;
  targetType: QrTargetType;
  targetId: string;
  validFrom: Date;
  active: boolean;
  validTo?: Date;
}

@Injectable()
export class MongoQrMappingStore implements QrMappingStorePort {
  constructor(
    @InjectModel(QR_MAPPING_MODEL) private readonly mappings: Model<Document>,
  ) {}

  async getActiveForTarget(
    type: QrTargetType,
    id: string,
    context?: UnitOfWorkContext,
  ): Promise<QrMapping | null> {
    let query = this.mappings.findOne({
      targetType: type,
      targetId: id,
      active: true,
    });
    if (context) query = query.session(context as unknown as ClientSession);
    const doc = await query.lean().exec();
    return doc ? toMapping(doc) : null;
  }

  async findActiveByValue(value: string): Promise<QrMapping | null> {
    const doc = await this.mappings
      .findOne({ value, active: true })
      .lean()
      .exec();
    return doc ? toMapping(doc) : null;
  }

  async replaceActive(
    mapping: QrMapping,
    context: UnitOfWorkContext,
  ): Promise<void> {
    const validFrom = mapping.validFrom ?? new Date();
    await this.mappings
      .findOneAndUpdate(
        {
          targetType: mapping.targetType,
          targetId: mapping.targetId,
          active: true,
        },
        { $set: { active: false, validTo: validFrom } },
        { returnDocument: 'after', session: context },
      )
      .lean()
      .exec();
    await this.mappings.create(
      [
        {
          id: mapping.id,
          value: mapping.value,
          targetType: mapping.targetType,
          targetId: mapping.targetId,
          validFrom,
          active: true,
        },
      ],
      { session: context },
    );
  }

  async deactivateActive(
    type: QrTargetType,
    id: string,
    context: UnitOfWorkContext,
  ): Promise<void> {
    const result = await this.mappings
      .findOneAndUpdate(
        { targetType: type, targetId: id, active: true },
        { $set: { active: false, validTo: new Date() } },
        { returnDocument: 'after', session: context },
      )
      .lean()
      .exec();
    if (!result)
      throw new Error('Active QR mapping disappeared during deactivation');
  }
}

function toMapping(doc: Document): QrMapping {
  return {
    id: doc.id,
    value: doc.value,
    targetType: doc.targetType,
    targetId: doc.targetId,
    active: doc.active,
  };
}
