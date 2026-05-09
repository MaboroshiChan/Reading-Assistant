import {Global, Module} from '@nestjs/common';
import { SurrealService } from './surrealdb.service';

@Global()
@Module({
    providers:[SurrealService],
    exports: [SurrealService]
})

export class SurrealModule {}