import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subject, from } from 'rxjs';
import { concatMap } from 'rxjs/operators';

@Injectable()
export class WorkflowQueueService implements OnModuleDestroy {
  private readonly taskSubject = new Subject<() => Promise<void>>();

  constructor() {
    this.taskSubject
      .pipe(
        concatMap((task) =>
          from(
            task().catch((err) => {
              console.error('[WorkflowQueueService] Task failed:', err);
            })
          )
        )
      )
      .subscribe();
  }

  enqueue(task: () => Promise<void>): void {
    this.taskSubject.next(task);
  }

  onModuleDestroy() {
    this.taskSubject.complete();
  }
}
