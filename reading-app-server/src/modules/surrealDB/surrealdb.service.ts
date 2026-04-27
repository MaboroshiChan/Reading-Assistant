import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class SurrealService implements OnModuleInit, OnModuleDestroy {
  public db: any;

  async onModuleInit() {
    try {
      // 使用动态导入来加载 ESM 模块
      const { Surreal } = await (eval('import("surrealdb")') as Promise<any>);
      this.db = new Surreal();

      // 1. 连接到本地服务器
      await this.db.connect('http://127.0.0.1:8000/rpc');

      // 2. 登录
      await this.db.signin({
        user: 'root',
        pass: 'root',
      });

      // 3. 选择命名空间和数据库
      await this.db.use({ ns: 'reading_app', db: 'assistant' });

      console.log('[SurrealDB] Connected successfully via dynamic import');
    } catch (err) {
      console.error('[SurrealDB] Connection failed:', err);
    }
  }

  async onModuleDestroy() {
    if (this.db) {
      await this.db.close();
    }
  }
}
