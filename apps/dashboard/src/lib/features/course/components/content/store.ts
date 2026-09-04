import { ContentType } from '@cio/utils/constants/content';
import { writable } from 'svelte/store';

export const contentCreateStore = writable({
  open: false,
  sectionId: '',
  initialType: ContentType.Section,
  skipTypeSelection: false
});

export const contentCreateStoreUtils = {
  openContentUnit: (sectionId: string) => {
    contentCreateStore.set({
      open: true,
      sectionId,
      initialType: ContentType.Lesson,
      skipTypeSelection: false
    });
  },
  openSection: () => {
    contentCreateStore.set({
      open: true,
      sectionId: '',
      initialType: ContentType.Section,
      skipTypeSelection: true
    });
  },
  /**
   * Straight to the exercise step, where importing a document is one of the choices.
   *
   * The exam creation screen needs this: a teacher whose questions are still in a file has
   * nothing to build an exam from, and sending them off to find the content screen was
   * sending them to a route that does not exist.
   */
  openExercise: () => {
    contentCreateStore.set({
      open: true,
      sectionId: '',
      initialType: ContentType.Exercise,
      skipTypeSelection: true
    });
  },
  openDefault: () => {
    contentCreateStore.set({
      open: true,
      sectionId: '',
      initialType: ContentType.Lesson,
      skipTypeSelection: false
    });
  },
  close: () => {
    contentCreateStore.set({
      open: false,
      sectionId: '',
      initialType: ContentType.Lesson,
      skipTypeSelection: false
    });
  }
};

export const contentEditingStore = writable<string | undefined>(undefined);
