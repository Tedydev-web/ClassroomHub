import { describe, expect, it } from 'vitest';
import type { ZipObjectWithMetadata } from './package';
import { normalizePackagePath, validateLaunchTargets } from './package';
import type { ParsedScormManifest } from './manifest';

function zipFile(name: string, unsafeOriginalName?: string): ZipObjectWithMetadata {
  return { name, unsafeOriginalName } as unknown as ZipObjectWithMetadata;
}

describe('normalizePackagePath', () => {
  it('normalizes a safe relative package path', () => {
    expect(normalizePackagePath(zipFile('./assets/course.js'))).toBe('assets/course.js');
  });

  it.each(['../secret.txt', 'assets/../../secret.txt', '/etc/passwd', 'C:/Windows/file.txt', 'assets\\file.js'])(
    'rejects unsafe package path %s',
    (unsafePath) => {
      expect(() => normalizePackagePath(zipFile('sanitized.txt', unsafePath))).toThrow('unsafe path');
    }
  );
});

describe('validateLaunchTargets', () => {
  function manifest(launchHref: string): ParsedScormManifest {
    return {
      identifier: 'manifest',
      title: 'Course',
      version: '1.2',
      entrypoint: launchHref,
      warnings: [],
      items: [
        {
          identifier: 'sco',
          parentIdentifier: null,
          resourceIdentifier: 'resource',
          title: 'SCO',
          launchHref,
          isLaunchable: true,
          order: 0
        }
      ]
    };
  }

  it('accepts a package-local launch target with query parameters', () => {
    expect(() => validateLaunchTargets(manifest('./index.html?mode=launch'), new Set(['index.html']))).not.toThrow();
  });

  it.each(['../outside.html', '/absolute.html', 'https://example.com/course.html', 'assets\\course.html'])(
    'rejects unsafe launch target %s',
    (launchTarget) => {
      expect(() => validateLaunchTargets(manifest(launchTarget), new Set([launchTarget]))).toThrow('unsafe');
    }
  );

  it('rejects a missing launch target', () => {
    expect(() => validateLaunchTargets(manifest('missing.html'), new Set(['index.html']))).toThrow(
      'was not found in the package'
    );
  });
});
