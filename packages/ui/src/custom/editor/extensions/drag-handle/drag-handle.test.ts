// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import initEditor from '../../editor';
import { DragHandlePlugin } from './index';

function createMountedEditor() {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const editor = initEditor({ element: mount, content: '<p>Paragraph</p>' });
  return { editor, mount };
}

describe('DragHandlePlugin', () => {
  it('binds each editor to its own explicit handle', () => {
    const first = createMountedEditor();
    const second = createMountedEditor();
    const firstHandle = document.createElement('div');
    const secondHandle = document.createElement('div');
    document.body.append(firstHandle, secondHandle);

    const querySelector = vi.spyOn(document, 'querySelector');

    first.editor.registerPlugin(
      DragHandlePlugin({
        pluginKey: 'dragHandleOne',
        dragHandleWidth: 20,
        scrollTreshold: 100,
        dragHandleElement: firstHandle,
        excludedTags: [],
        customNodes: []
      })
    );
    second.editor.registerPlugin(
      DragHandlePlugin({
        pluginKey: 'dragHandleTwo',
        dragHandleWidth: 20,
        scrollTreshold: 100,
        dragHandleElement: secondHandle,
        excludedTags: [],
        customNodes: []
      })
    );

    // Both elements are initialised and hidden independently. The former global
    // selector left the second component's six-dot icon visible and fixed in
    // place because every plugin bound itself to the first matching handle.
    expect(firstHandle.draggable).toBe(true);
    expect(secondHandle.draggable).toBe(true);
    expect(firstHandle.classList.contains('hide')).toBe(true);
    expect(secondHandle.classList.contains('hide')).toBe(true);
    expect(querySelector).not.toHaveBeenCalled();

    first.editor.destroy();
    second.editor.destroy();
    firstHandle.remove();
    secondHandle.remove();
    first.mount.remove();
    second.mount.remove();
    querySelector.mockRestore();
  });

  it('does not remove an externally owned handle when the editor is destroyed', () => {
    const { editor, mount } = createMountedEditor();
    const handle = document.createElement('div');
    document.body.appendChild(handle);

    editor.registerPlugin(
      DragHandlePlugin({
        pluginKey: 'externalDragHandle',
        dragHandleWidth: 20,
        scrollTreshold: 100,
        dragHandleElement: handle,
        excludedTags: [],
        customNodes: []
      })
    );

    editor.destroy();

    expect(handle.isConnected).toBe(true);
    handle.remove();
    mount.remove();
  });
});
