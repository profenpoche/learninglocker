import { Module } from '@nestjs/common';
import { PersonaController } from '../persona/persona.controller.js';
import { StatementsController } from '../statements/statements.controller.js';
import { RestController } from './rest.controller.js';

/**
 * Lectures. Les routes précises (/v2/persona/count, /statements/count) sont déclarées avant les routes
 * génériques `/v2/:model…` (celles-ci laissent passer les modèles qu'elles ne servent pas).
 */
@Module({ controllers: [PersonaController, StatementsController, RestController] })
export class RestModule {}
