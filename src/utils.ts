const RecordUtils = {
  map<T, R>(record: Record<string, T>, fn: (value: T, key: string) => R): Record<string, R> {
    return Object.entries(record).reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: fn(value, key),
      }),
      {}
    );
  },

  filter<T>(record: Record<string, T>, fn: (value: T, key: string) => boolean): Record<string, T> {
    return Object.entries(record)
      .filter(([key, value]) => fn(value, key))
      .reduce(
        (acc, [key, value]) => ({
          ...acc,
          [key]: value,
        }),
        {}
      );
  },

  forEach<T>(record: Record<string, T>, fn: (value: T, key: string) => void): void {
    Object.entries(record).forEach(([key, value]) => fn(value, key));
  },

  transform<T, R>(record: Record<string, T>, fn: (value: T, key: string) => R): Record<string, R> {
    return Object.entries(record).reduce(
      (acc, [key, value]) => ({
        ...acc,
        [key]: fn(value, key),
      }),
      {}
    );
  },
};

export { RecordUtils };
