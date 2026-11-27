import { Module } from '@nestjs/common';
import { RelayController } from './relay.controller.js';

/** Doit rester le dernier module importé par AppModule : sa route attrape-tout est enregistrée en dernier. */
@Module({ controllers: [RelayController] })
export class RelayModule {}
