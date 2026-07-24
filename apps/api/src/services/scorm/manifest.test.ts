import { describe, expect, it } from 'vitest';
import { parseScormManifest } from './manifest';

describe('parseScormManifest', () => {
  it('parses SCORM 1.2 hierarchy and launch resources', () => {
    const result = parseScormManifest(`
      <manifest identifier="course-1">
        <metadata><schemaversion>1.2</schemaversion></metadata>
        <organizations default="org-1">
          <organization identifier="org-1">
            <title>Safety Training</title>
            <item identifier="module-1">
              <title>Module 1</title>
              <item identifier="sco-1" identifierref="resource-1"><title>Introduction</title></item>
            </item>
          </organization>
        </organizations>
        <resources>
          <resource identifier="resource-1" href="index.html" adlcp:scormtype="sco" />
        </resources>
      </manifest>
    `);

    expect(result).toMatchObject({
      identifier: 'course-1',
      title: 'Safety Training',
      version: '1.2',
      entrypoint: 'index.html'
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toMatchObject({ parentIdentifier: 'module-1', isLaunchable: true });
  });

  it('detects SCORM 2004 and supports a single item', () => {
    const result = parseScormManifest(`
      <manifest identifier="course-2004">
        <metadata><schemaversion>2004 4th Edition</schemaversion></metadata>
        <organizations><organization identifier="org"><title>Compliance</title>
          <item identifier="sco" identifierref="resource"><title>Policy</title></item>
        </organization></organizations>
        <resources><resource identifier="resource" href="launch.htm" /></resources>
      </manifest>
    `);

    expect(result.version).toBe('2004');
    expect(result.entrypoint).toBe('launch.htm');
  });

  it('rejects a manifest without a launchable resource', () => {
    expect(() =>
      parseScormManifest(`
        <manifest><organizations><organization><item identifier="item" /></organization></organizations><resources><resource identifier="unused" /></resources></manifest>
      `)
    ).toThrow('no launchable items');
  });
});
