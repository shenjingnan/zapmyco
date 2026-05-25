/**
 * TextLineStream — 从 @std/streams 内联
 *
 * 将文本流按行分割的 TransformStream。
 * 内联此实现以避免对 jsr:@std/streams 的依赖，
 * 从而简化 dnt 构建（dnt 不支持 jsr: 协议）。
 */

export class TextLineStream extends TransformStream<string, string> {
  private buffer = '';

  constructor() {
    super({
      transform: (chunk, controller) => {
        this.buffer += chunk;
        const parts = this.buffer.split('\n');
        this.buffer = parts.pop() ?? '';
        for (const line of parts) {
          controller.enqueue(line + '\n');
        }
      },
      flush: (controller) => {
        if (this.buffer) {
          controller.enqueue(this.buffer);
        }
      },
    });
  }
}
