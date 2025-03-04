import { CardComponent } from '@/types';
import { HassEntity } from 'home-assistant-js-websocket';

// 卡片注册中心
class CardRegistry {
  private cards: CardComponent<any>[] = [];

  // 注册卡片
  register(card: CardComponent<any>) {
    this.cards.push(card);
    return this;
  }

  // 根据entity匹配卡片
  findCardForEntity(entity: HassEntity): CardComponent<any> | undefined {
    return this.cards.find((card) => card.meta.matcher(entity));
  }

  // 获取所有已注册卡片
  getAllCards() {
    return [...this.cards];
  }
}

// 单例实例
const cardRegistry = new CardRegistry();

export { cardRegistry };
