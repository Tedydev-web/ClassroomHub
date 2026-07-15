<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Spinner } from '@cio/ui/base/spinner';
  import { scormApi } from '$features/course/api';
  import type { ScormContent, ScormLaunch } from '$features/course/utils/types';

  interface Props {
    content: NonNullable<ScormContent>;
    courseId: string;
    lessonId: string;
  }

  type ScormApiMethods = {
    Initialize: (argument: string) => string;
    Terminate: (argument: string) => string;
    GetValue: (element: string) => string;
    SetValue: (element: string, value: string) => string;
    Commit: (argument: string) => string;
    GetLastError: () => string;
    GetErrorString: (errorCode: string) => string;
    GetDiagnostic: (errorCode: string) => string;
  };

  type Scorm12ApiMethods = {
    LMSInitialize: ScormApiMethods['Initialize'];
    LMSFinish: ScormApiMethods['Terminate'];
    LMSGetValue: ScormApiMethods['GetValue'];
    LMSSetValue: ScormApiMethods['SetValue'];
    LMSCommit: ScormApiMethods['Commit'];
    LMSGetLastError: ScormApiMethods['GetLastError'];
    LMSGetErrorString: ScormApiMethods['GetErrorString'];
    LMSGetDiagnostic: ScormApiMethods['GetDiagnostic'];
  };

  type ScormWindow = Window & {
    API?: Scorm12ApiMethods;
    API_1484_11?: ScormApiMethods;
  };

  let { content, courseId, lessonId }: Props = $props();
  let frameUrl = $state<string | null>(null);
  let loadFailed = $state(false);
  let initialized = false;
  let terminated = false;
  let launch: ScormLaunch | null = null;
  let values: Record<string, string> = {};
  let dirtyValues: Record<string, string> = {};
  let lastError = '0';
  let saveChain = Promise.resolve();
  let commitInterval: ReturnType<typeof setInterval> | undefined;

  const errorMessages: Record<string, string> = {
    '0': 'No error',
    '101': 'General exception',
    '103': 'Already initialized',
    '112': 'Termination before initialization',
    '113': 'Termination after termination',
    '122': 'Retrieve data before initialization',
    '132': 'Store data before initialization',
    '142': 'Commit before initialization',
    '201': 'Invalid argument error'
  };

  function setError(code: string) {
    lastError = code;
    return 'false';
  }

  function initialize(argument: string) {
    if (argument !== '') return setError('201');
    if (initialized) return setError('103');
    if (terminated) return setError('101');

    initialized = true;
    lastError = '0';
    return 'true';
  }

  function getValue(element: string) {
    if (!initialized) {
      setError('122');
      return '';
    }

    lastError = '0';
    return values[element] ?? '';
  }

  function setValue(element: string, value: string) {
    if (!initialized) return setError('132');
    if (!element) return setError('201');

    values[element] = value;
    dirtyValues[element] = value;
    lastError = '0';
    return 'true';
  }

  function enqueueSave(terminate: boolean) {
    if (!launch || (terminate && terminated)) return;

    const pendingValues = dirtyValues;
    dirtyValues = {};
    if (terminate) terminated = true;

    saveChain = saveChain.then(async () => {
      const response = terminate
        ? await scormApi.terminate(courseId, lessonId, launch!.attemptId, pendingValues)
        : await scormApi.commit(courseId, lessonId, launch!.attemptId, pendingValues);
      if (!response) dirtyValues = { ...pendingValues, ...dirtyValues };
    });
  }

  function commit(argument: string) {
    if (argument !== '') return setError('201');
    if (!initialized) return setError('142');

    enqueueSave(false);
    lastError = '0';
    return 'true';
  }

  function terminate(argument: string) {
    if (argument !== '') return setError('201');
    if (!initialized) return setError('112');
    if (terminated) return setError('113');

    enqueueSave(true);
    initialized = false;
    lastError = '0';
    return 'true';
  }

  function getErrorString(errorCode: string) {
    return errorMessages[errorCode] ?? 'Unknown error';
  }

  function installRuntimeApi() {
    const standardApi: ScormApiMethods = {
      Initialize: initialize,
      Terminate: terminate,
      GetValue: getValue,
      SetValue: setValue,
      Commit: commit,
      GetLastError: () => lastError,
      GetErrorString: getErrorString,
      GetDiagnostic: getErrorString
    };
    const scorm12Api: Scorm12ApiMethods = {
      LMSInitialize: initialize,
      LMSFinish: terminate,
      LMSGetValue: getValue,
      LMSSetValue: setValue,
      LMSCommit: commit,
      LMSGetLastError: () => lastError,
      LMSGetErrorString: getErrorString,
      LMSGetDiagnostic: getErrorString
    };
    const runtimeWindow = window as ScormWindow;
    runtimeWindow.API = scorm12Api;
    runtimeWindow.API_1484_11 = standardApi;
  }

  function createFrameUrl(launchPath: string) {
    const parsed = new URL(launchPath, 'http://scorm.local');
    const encodedPath = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const coursePath = encodeURIComponent(courseId);
    const lessonPath = encodeURIComponent(lessonId);

    return `/proxy/course/${coursePath}/lesson/${lessonPath}/scorm/assets/${encodedPath}${parsed.search}${parsed.hash}`;
  }

  function handleBeforeUnload() {
    if (initialized && !terminated) terminate('');
  }

  onMount(async () => {
    const response = await scormApi.launch(courseId, lessonId);
    if (!response) {
      loadFailed = true;
      return;
    }

    launch = response.data;
    values = { ...response.data.values };
    installRuntimeApi();
    frameUrl = createFrameUrl(response.data.launchPath);
    commitInterval = setInterval(() => {
      if (initialized && Object.keys(dirtyValues).length > 0) enqueueSave(false);
    }, 30_000);
    window.addEventListener('beforeunload', handleBeforeUnload);
  });

  onDestroy(() => {
    if (commitInterval) clearInterval(commitInterval);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    if (initialized && !terminated) terminate('');

    const runtimeWindow = window as ScormWindow;
    delete runtimeWindow.API;
    delete runtimeWindow.API_1484_11;
  });
</script>

{#if frameUrl}
  <iframe
    src={frameUrl}
    title={content.title}
    class="min-h-[70vh] w-full border-0"
    sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
    allow="autoplay; fullscreen"
  ></iframe>
{:else if !loadFailed}
  <div class="flex min-h-64 items-center justify-center" aria-busy="true">
    <Spinner class="ui:text-muted-foreground size-6" />
  </div>
{/if}
