import { describe, expect, it } from 'vitest';
import { ToolValidationError, validateToolCallArguments } from '../../llm/tool-validator';

// ============ 测试数据：Schema 定义 ============

const stringParams = {
  type: 'object',
  properties: {
    name: { type: 'string' },
  },
  required: ['name'],
};

const numberParams = {
  type: 'object',
  properties: {
    score: { type: 'number' },
  },
  required: ['score'],
};

const integerParams = {
  type: 'object',
  properties: {
    age: { type: 'integer' },
  },
  required: ['age'],
};

const booleanParams = {
  type: 'object',
  properties: {
    active: { type: 'boolean' },
  },
  required: ['active'],
};

const arrayParams = {
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['tags'],
};

const nestedObjectParams = {
  type: 'object',
  properties: {
    user: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name'],
    },
  },
  required: ['user'],
};

const enumParams = {
  type: 'object',
  properties: {
    color: { type: 'string', enum: ['red', 'green', 'blue'] },
  },
  required: ['color'],
};

const emptyEnumParams = {
  type: 'object',
  properties: {
    color: { type: 'string', enum: [] },
  },
  required: ['color'],
};

const optionalParams = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer' },
  },
  required: ['name'],
};

const defaultParams = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    count: { type: 'integer', default: 42 },
  },
  required: ['name'],
};

const allOptionalParams = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer' },
  },
};

const emptyParams = {};

const noPropertiesParams = {
  type: 'object',
};

// ============ ToolValidationError 类测试 ============

describe('ToolValidationError', () => {
  it('构造函数正确设置 toolName、zodIssues、rawArgs 属性', () => {
    const issues = [{ code: 'custom' as const, path: ['name'], message: 'Required' }];
    const rawArgs = { bad: 'data' };

    const error = new ToolValidationError('testTool', issues, rawArgs);

    expect(error.toolName).toBe('testTool');
    expect(error.zodIssues).toBe(issues);
    expect(error.rawArgs).toBe(rawArgs);
  });

  it('name 属性为 "ToolValidationError"', () => {
    const error = new ToolValidationError('testTool', [], {});

    expect(error.name).toBe('ToolValidationError');
  });

  it('message 包含工具名称和格式化错误信息', () => {
    const issues = [{ code: 'custom' as const, path: ['name'], message: 'Required' }];
    const rawArgs = { bad: 'data' };

    const error = new ToolValidationError('testTool', issues, rawArgs);

    expect(error.message).toContain('testTool');
    expect(error.message).toContain('name');
    expect(error.message).toContain('Required');
    expect(error.message).toContain('Received arguments');
  });

  it('是 Error 的实例', () => {
    const error = new ToolValidationError('testTool', [], {});
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ToolValidationError);
  });
});

// ============ validateToolCallArguments: String 类型 ============

describe('validateToolCallArguments - String 类型', () => {
  it('传入有效 string 参数，返回校验后的数据', () => {
    const result = validateToolCallArguments('test', stringParams, { name: 'Alice' });
    expect(result).toEqual({ name: 'Alice' });
  });

  it('传入非 string 参数（number），抛出 ToolValidationError', () => {
    expect(() =>
      validateToolCallArguments('test', stringParams, { name: 123 as unknown as string })
    ).toThrow(ToolValidationError);
  });
});

// ============ validateToolCallArguments: Number 类型 ============

describe('validateToolCallArguments - Number 类型', () => {
  it('传入有效 number 参数，返回校验后的数据', () => {
    const result = validateToolCallArguments('test', numberParams, { score: 95.5 });
    expect(result).toEqual({ score: 95.5 });
  });

  it('传入非 number 参数，抛出 ToolValidationError', () => {
    expect(() =>
      validateToolCallArguments('test', numberParams, { score: 'abc' as unknown as number })
    ).toThrow(ToolValidationError);
  });
});

// ============ validateToolCallArguments: Integer 类型 ============

describe('validateToolCallArguments - Integer 类型', () => {
  it('传入有效 integer，返回校验后的数据', () => {
    const result = validateToolCallArguments('test', integerParams, { age: 25 });
    expect(result).toEqual({ age: 25 });
  });

  it('传入 float，抛出 ToolValidationError', () => {
    expect(() => validateToolCallArguments('test', integerParams, { age: 3.14 })).toThrow(
      ToolValidationError
    );
  });
});

// ============ validateToolCallArguments: Boolean 类型 ============

describe('validateToolCallArguments - Boolean 类型', () => {
  it('传入有效 boolean，返回校验后的数据', () => {
    const result = validateToolCallArguments('test', booleanParams, { active: true });
    expect(result).toEqual({ active: true });
  });

  it('传入非 boolean 参数，抛出 ToolValidationError', () => {
    expect(() =>
      validateToolCallArguments('test', booleanParams, { active: 'yes' as unknown as boolean })
    ).toThrow(ToolValidationError);
  });
});

// ============ validateToolCallArguments: Array 类型 ============

describe('validateToolCallArguments - Array 类型', () => {
  it('传入有效 array，返回校验后的数据', () => {
    const result = validateToolCallArguments('test', arrayParams, { tags: ['a', 'b', 'c'] });
    expect(result).toEqual({ tags: ['a', 'b', 'c'] });
  });

  it('传入非数组参数，抛出 ToolValidationError', () => {
    expect(() =>
      validateToolCallArguments('test', arrayParams, {
        tags: 'not-an-array' as unknown as string[],
      })
    ).toThrow(ToolValidationError);
  });
});

// ============ validateToolCallArguments: Object 嵌套类型 ============

describe('validateToolCallArguments - Object 嵌套类型', () => {
  it('传入有效的嵌套对象参数，返回校验后的数据', () => {
    const result = validateToolCallArguments('test', nestedObjectParams, {
      user: { name: 'Alice', age: 30 },
    });
    expect(result).toEqual({ user: { name: 'Alice', age: 30 } });
  });

  it('嵌套对象中类型不匹配时，抛出 ToolValidationError', () => {
    expect(() =>
      validateToolCallArguments('test', nestedObjectParams, {
        user: { name: 123 },
      })
    ).toThrow(ToolValidationError);
  });
});

// ============ validateToolCallArguments: Enum 类型 ============

describe('validateToolCallArguments - Enum 类型', () => {
  it('传入在 enum 值列表中的值，校验通过', () => {
    const result = validateToolCallArguments('test', enumParams, { color: 'red' });
    expect(result).toEqual({ color: 'red' });
  });

  it('传入不在 enum 列表中的值，抛出 ToolValidationError', () => {
    expect(() => validateToolCallArguments('test', enumParams, { color: 'yellow' })).toThrow(
      ToolValidationError
    );
  });

  it('传入空 enum 列表时，退回到按 type 处理（string）', () => {
    // 空 enum 列表，应该退回到按 type: 'string' 处理
    const result = validateToolCallArguments('test', emptyEnumParams, { color: 'any-string' });
    expect(result).toEqual({ color: 'any-string' });
  });
});

// ============ validateToolCallArguments: Required 字段 ============

describe('validateToolCallArguments - Required 字段', () => {
  it('缺少 required 字段时，抛出 ToolValidationError', () => {
    expect(() =>
      validateToolCallArguments('test', stringParams, {} as Record<string, unknown>)
    ).toThrow(ToolValidationError);
  });

  it('optional 字段可以省略，校验通过', () => {
    const result = validateToolCallArguments('test', optionalParams, { name: 'Alice' });
    expect(result).toEqual({ name: 'Alice' });
  });
});

// ============ validateToolCallArguments: Default 值 ============

describe('validateToolCallArguments - Default 值', () => {
  it('未提供带 default 的字段时，返回的数据中包含默认值', () => {
    const result = validateToolCallArguments('test', defaultParams, { name: 'Alice' });
    expect(result).toEqual({ name: 'Alice', count: 42 });
  });

  it('提供了值时不被默认值覆盖', () => {
    const result = validateToolCallArguments('test', defaultParams, { name: 'Alice', count: 100 });
    expect(result).toEqual({ name: 'Alice', count: 100 });
  });
});

// ============ validateToolCallArguments: 边界情况 ============

describe('validateToolCallArguments - 边界情况', () => {
  it('空参数定义 {}，任意参数校验通过', () => {
    const result = validateToolCallArguments('test', emptyParams, { anything: 'goes' });
    expect(result).toEqual({});
  });

  it('空的 args 且所有字段都是 optional，校验通过', () => {
    const result = validateToolCallArguments('test', allOptionalParams, {});
    expect(result).toEqual({});
  });

  it('没有 properties 的 schema，校验通过', () => {
    const result = validateToolCallArguments('test', noPropertiesParams, { foo: 'bar' });
    expect(result).toEqual({});
  });

  it('args 为 undefined 时，当作空对象处理', () => {
    const result = validateToolCallArguments(
      'test',
      allOptionalParams,
      undefined as unknown as Record<string, unknown>
    );
    expect(result).toEqual({});
  });

  it('args 为 null 时，当作空对象处理', () => {
    const result = validateToolCallArguments(
      'test',
      allOptionalParams,
      null as unknown as Record<string, unknown>
    );
    expect(result).toEqual({});
  });
});

// ============ 错误消息格式 ============

describe('validateToolCallArguments - 错误消息格式', () => {
  it('错误消息包含工具名称', () => {
    try {
      validateToolCallArguments('myTestTool', stringParams, { name: 123 as unknown as string });
    } catch (e) {
      expect((e as ToolValidationError).message).toContain('myTestTool');
    }
  });

  it('错误消息包含具体的验证路径和错误原因', () => {
    try {
      validateToolCallArguments('test', stringParams, { name: 123 as unknown as string });
    } catch (e) {
      const msg = (e as ToolValidationError).message;
      expect(msg).toMatch(/name/);
      expect(msg).toMatch(/string/i);
    }
  });

  it('错误消息包含收到的原始参数', () => {
    try {
      validateToolCallArguments('test', stringParams, { name: 123 as unknown as string });
    } catch (e) {
      expect((e as ToolValidationError).message).toContain('Received arguments');
      expect((e as ToolValidationError).message).toContain('123');
    }
  });

  it('多个字段校验失败时，错误消息包含所有路径', () => {
    const multiParams = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name', 'age'],
    };

    try {
      validateToolCallArguments('test', multiParams, { name: 123, age: 'abc' } as unknown as Record<
        string,
        unknown
      >);
    } catch (e) {
      const msg = (e as ToolValidationError).message;
      expect(msg).toContain('name');
      expect(msg).toContain('age');
    }
  });

  it('缺少字段时，错误消息包含字段路径', () => {
    try {
      validateToolCallArguments('test', stringParams, {} as Record<string, unknown>);
    } catch (e) {
      const msg = (e as ToolValidationError).message;
      // Zod 对于 required 字段缺失，path 为字段名，显示字段路径
      expect(msg).toContain('name');
      expect(msg).toContain('undefined');
    }
  });
});
