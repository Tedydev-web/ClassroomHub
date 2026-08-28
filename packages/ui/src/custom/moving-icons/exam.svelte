<script>
  /**
   * @typedef {Object} Props
   * @property {string} [color]
   * @property {number} [size]
   * @property {number} [strokeWidth]
   * @property {boolean} [isHovered]
   * @property {string} [class]
   */

  /** @type {Props} */
  let { color = 'currentColor', size = 24, strokeWidth = 2, isHovered = false, class: className = '' } = $props();

  function handleMouseEnter() {
    isHovered = true;

    setTimeout(() => {
      isHovered = false;
    }, 500);
  }
</script>

<div class={className} aria-label="exam" role="img" onmouseenter={handleMouseEnter}>
  <!--
    A paper on a clipboard: the exercise icon's checklist says "work through this", and an
    exam is the same work under a clock and a hand-in. The check draws itself on hover with
    the exercise icon's timing, so the two read as members of one family rather than as an
    icon borrowed from somewhere else.
  -->
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    stroke-width={strokeWidth}
    stroke-linecap="round"
    stroke-linejoin="round"
    class="exam-icon"
    class:animate={isHovered}
  >
    <path d="M9 3h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M16 4.5h2a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h2" />
    <path d="M8.5 14.5l2 2 4.5-4.5" class="check-path" />
  </svg>
</div>

<style>
  div {
    display: inline-block;
  }
  .exam-icon {
    overflow: visible;
  }

  .check-path {
    stroke-dasharray: 12;
    stroke-dashoffset: 0;
    transition:
      stroke-dashoffset 0.125s ease-out,
      opacity 0.125s ease-out;
  }

  .exam-icon.animate .check-path {
    animation: checkAnimation 0.5s ease-out backwards;
  }

  @keyframes checkAnimation {
    0% {
      stroke-dashoffset: 12;
      opacity: 0;
    }
    33% {
      stroke-dashoffset: 12;
      opacity: 0;
    }
    100% {
      stroke-dashoffset: 0;
      opacity: 1;
    }
  }
</style>
