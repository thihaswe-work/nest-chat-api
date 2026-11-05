/**
 * Placeholder: MongoDB connection setup.
 *
 * The actual Mongoose connection is configured in src/app.module.ts with
 * MongooseModule.forRootAsync(), because the root module owns the single shared
 * connection for the whole app. Schemas are then registered per feature module.
 *
 * This file is unused and can be deleted, or turned into a dedicated
 * DatabaseModule that exports the connection if the configuration grows.
 */
export {};
