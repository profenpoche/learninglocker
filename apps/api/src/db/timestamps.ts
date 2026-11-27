// Plugin mongoose-timestamp 0.5.0 (utilisé par la plupart des modèles legacy) : champs createdAt et
// updatedAt de type Date, posés à l'enregistrement. À ne pas confondre avec l'option `timestamps`
// de Mongoose, dont la sémantique diffère (updatedAt mis à jour même sans modification, etc.).
// Code d'origine : node_modules/mongoose-timestamp@0.5.0/index.js.
import type { Schema } from 'mongoose';

interface Timestamped {
  createdAt?: Date;
  updatedAt?: Date;
  isModified(): boolean;
}

export const timestampsPlugin = (schema: Schema): void => {
  schema.add({ updatedAt: Date, createdAt: Date });
  schema.pre('save', function preSave(this: Timestamped) {
    if (!this.createdAt) {
      const now = new Date();
      this.createdAt = now;
      this.updatedAt = now;
    } else if (this.isModified()) {
      this.updatedAt = new Date();
    }
  });
};
