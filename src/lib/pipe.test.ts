import { describe, it, expect } from 'vitest';
import { pipe } from './pipe';

describe('pipe utility', () => {
  describe('basic functionality', () => {
    it('should return value unchanged with no transformations', () => {
      expect(pipe(42)).toBe(42);
      expect(pipe('hello')).toBe('hello');
      expect(pipe({ a: 1 })).toEqual({ a: 1 });
    });

    it('should apply single transformation', () => {
      const double = (x: number) => x * 2;
      expect(pipe(5, double)).toBe(10);
    });

    it('should apply multiple transformations in sequence', () => {
      const add1 = (x: number) => x + 1;
      const double = (x: number) => x * 2;
      const toString = (x: number) => x.toString();

      const result = pipe(5, add1, double, toString);
      expect(result).toBe('12'); // (5 + 1) * 2 = 12, then toString
    });
  });

  describe('type transformations', () => {
    it('should handle type transformations correctly', () => {
      const result = pipe(
        5,
        (x) => x * 2, // number -> number
        (x) => x.toString(), // number -> string
        (x) => x.length, // string -> number
        (x) => x > 1 // number -> boolean
      );

      expect(result).toBe(true); // '10'.length = 2, 2 > 1 = true
    });

    it('should handle object transformations', () => {
      const result = pipe(
        { name: 'John', age: 30 },
        (person) => ({ ...person, adult: person.age >= 18 }),
        (person) => person.name.toUpperCase(),
        (name) => `Hello, ${name}!`
      );

      expect(result).toBe('Hello, JOHN!');
    });
  });

  describe('complex transformations', () => {
    it('should handle array transformations', () => {
      const result = pipe(
        [1, 2, 3, 4, 5],
        (arr) => arr.filter((x) => x % 2 === 0),
        (arr) => arr.map((x) => x * 2),
        (arr) => arr.reduce((sum, x) => sum + x, 0)
      );

      expect(result).toBe(12); // [2, 4] -> [4, 8] -> 12
    });

    it('should handle async transformations with Promise', async () => {
      const asyncDouble = (x: number) => Promise.resolve(x * 2);
      const asyncAdd = (x: number) => Promise.resolve(x + 1);

      const result = await pipe(
        5,
        asyncDouble,
        async (x) => await asyncAdd(await x),
        async (x) => (await x).toString()
      );

      expect(result).toBe('11'); // 5 * 2 = 10, 10 + 1 = 11
    });
  });

  describe('edge cases', () => {
    it('should handle null and undefined', () => {
      expect(pipe(null)).toBe(null);
      expect(pipe(undefined)).toBe(undefined);

      const handleNull = (x: any) => x ?? 'default';
      expect(pipe(null, handleNull)).toBe('default');
      expect(pipe(undefined, handleNull)).toBe('default');
    });

    it('should handle empty transformations', () => {
      const value = { test: 'value' };
      expect(pipe(value)).toBe(value);
      expect(pipe(value)).toEqual(value);
    });

    it('should handle identity functions', () => {
      const identity = <T>(x: T) => x;
      const result = pipe(42, identity, identity, identity);
      expect(result).toBe(42);
    });

    it('should handle functions that return different types', () => {
      const numberToString = (x: number) => `number: ${x}`;
      const stringLength = (x: string) => x.length;
      const isEven = (x: number) => x % 2 === 0;

      const result = pipe(123, numberToString, stringLength, isEven);
      // 'number: 123'.length = 11, 11 % 2 === 1, so false
      expect(result).toBe(false);
    });
  });

  describe('functional composition patterns', () => {
    it('should work with curried functions', () => {
      const add = (a: number) => (b: number) => a + b;
      const multiply = (a: number) => (b: number) => a * b;

      const result = pipe(
        5,
        add(3), // 5 + 3 = 8
        multiply(2) // 8 * 2 = 16
      );

      expect(result).toBe(16);
    });

    it('should work with higher-order functions', () => {
      const mapFn =
        <T, U>(fn: (x: T) => U) =>
        (arr: T[]) =>
          arr.map(fn);
      const filterFn =
        <T>(predicate: (x: T) => boolean) =>
        (arr: T[]) =>
          arr.filter(predicate);

      const result = pipe(
        [1, 2, 3, 4, 5],
        filterFn((x: number) => x > 2),
        mapFn((x: number) => x * 2)
      );

      expect(result).toEqual([6, 8, 10]);
    });

    it('should support method chaining style', () => {
      // Simulate method chaining with pipe
      const chainable = (value: string) => ({
        toUpper: () => chainable(value.toUpperCase()),
        toLowerCase: () => chainable(value.toLowerCase()),
        trim: () => chainable(value.trim()),
        getValue: () => value,
      });

      const result = pipe(
        '  Hello World  ',
        (s) => chainable(s),
        (c) => c.trim(),
        (c) => c.toUpper(),
        (c) => c.getValue()
      );

      expect(result).toBe('HELLO WORLD');
    });
  });

  describe('error handling', () => {
    it('should propagate errors in the chain', () => {
      const throwError = (): never => {
        throw new Error('Test error');
      };

      expect(() => {
        pipe(5, (x) => x * 2, throwError);
      }).toThrow('Test error');
    });

    it('should handle errors at any stage', () => {
      const maybeError = (x: number) => {
        if (x > 10) throw new Error('Too big');
        return x;
      };

      expect(() => pipe(15, maybeError)).toThrow('Too big');
      expect(pipe(5, maybeError)).toBe(5);
    });
  });

  describe('performance', () => {
    it('should handle long chains efficiently', () => {
      const add1 = (x: number) => x + 1;

      // Create a chain by reducing operations
      let result = 0;
      for (let i = 0; i < 1000; i++) {
        result = add1(result);
      }

      expect(result).toBe(1000);
    });

    it('should not modify original data', () => {
      const original = { count: 5, items: [1, 2, 3] };
      const result = pipe(
        original,
        (obj) => ({ ...obj, count: obj.count + 1 }),
        (obj) => ({ ...obj, items: [...obj.items, 4] })
      );

      expect(original.count).toBe(5);
      expect(original.items).toEqual([1, 2, 3]);
      expect(result.count).toBe(6);
      expect(result.items).toEqual([1, 2, 3, 4]);
    });
  });

  describe('real world examples', () => {
    it('should handle data processing pipeline', () => {
      interface User {
        id: number;
        name: string;
        email: string;
        active: boolean;
      }

      const users: User[] = [
        { id: 1, name: 'Alice', email: 'alice@example.com', active: true },
        { id: 2, name: 'Bob', email: 'bob@example.com', active: false },
        { id: 3, name: 'Charlie', email: 'charlie@example.com', active: true },
      ];

      const result = pipe(
        users,
        (users) => users.filter((u) => u.active),
        (users) => users.map((u) => ({ ...u, name: u.name.toUpperCase() })),
        (users) => users.sort((a, b) => a.name.localeCompare(b.name)),
        (users) => users.map((u) => u.email)
      );

      expect(result).toEqual(['alice@example.com', 'charlie@example.com']);
    });

    it('should handle configuration transformation', () => {
      const config = {
        database: { host: 'localhost', port: 5432 },
        cache: { enabled: false, ttl: 3600 },
        features: ['auth', 'logging'],
      };

      const result = pipe(
        config,
        (cfg) => ({ ...cfg, cache: { ...cfg.cache, enabled: true } }),
        (cfg) => ({ ...cfg, features: [...cfg.features, 'monitoring'] }),
        (cfg) => ({
          ...cfg,
          database: {
            ...cfg.database,
            connectionString: `postgres://${cfg.database.host}:${cfg.database.port}`,
          },
        })
      );

      expect(result.cache.enabled).toBe(true);
      expect(result.features).toContain('monitoring');
      expect(result.database.connectionString).toBe(
        'postgres://localhost:5432'
      );
    });
  });
});
