import React from 'react';
import { Delete, CornerDownLeft, Search } from 'lucide-react';

export interface SearchTextEditResult {
  value: string;
  nextCursor: number;
}

export function insertSearchTextAtCursor(
  current: string,
  textToInsert: string,
  selectionStart?: number | null,
  selectionEnd?: number | null
): SearchTextEditResult {
  if (
    typeof selectionStart === 'number' &&
    typeof selectionEnd === 'number' &&
    selectionStart >= 0 &&
    selectionEnd >= selectionStart &&
    selectionEnd <= current.length
  ) {
    const value = current.slice(0, selectionStart) + textToInsert + current.slice(selectionEnd);
    return {
      value,
      nextCursor: selectionStart + textToInsert.length,
    };
  }

  const value = current + textToInsert;
  return {
    value,
    nextCursor: value.length,
  };
}

export function backspaceSearchTextAtCursor(
  current: string,
  selectionStart?: number | null,
  selectionEnd?: number | null
): SearchTextEditResult {
  if (!current) {
    return { value: '', nextCursor: 0 };
  }

  if (
    typeof selectionStart === 'number' &&
    typeof selectionEnd === 'number' &&
    selectionStart >= 0 &&
    selectionEnd >= selectionStart &&
    selectionEnd <= current.length
  ) {
    if (selectionEnd > selectionStart) {
      return {
        value: current.slice(0, selectionStart) + current.slice(selectionEnd),
        nextCursor: selectionStart,
      };
    }
    if (selectionStart === 0) {
      return { value: current, nextCursor: 0 };
    }
    return {
      value: current.slice(0, selectionStart - 1) + current.slice(selectionStart),
      nextCursor: selectionStart - 1,
    };
  }

  const value = current.slice(0, -1);
  return {
    value,
    nextCursor: value.length,
  };
}

export const KEYBOARD_NUMBER_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const;
export const KEYBOARD_TOP_ALPHA_ROW = ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'] as const;
export const KEYBOARD_MID_ALPHA_ROW = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'] as const;
export const KEYBOARD_BOT_ALPHA_ROW = ['z', 'x', 'c', 'v', 'b', 'n', 'm'] as const;

interface CompactSearchKeyboardProps {
  onKeyPress: (char: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSearch: () => void;
  containerRef?: React.RefObject<HTMLDivElement | null>;
}

export const CompactSearchKeyboard: React.FC<CompactSearchKeyboardProps> = ({
  onKeyPress,
  onBackspace,
  onClear,
  onSearch,
  containerRef,
}) => {
  const preventFocusSteal = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  };

  const baseKeyClass =
    'yk-kb-key h-7 sm:h-8 [@media(orientation:landscape)_and_(max-height:500px)]:h-6 rounded-lg bg-[#181926] hover:bg-[#24263A] active:bg-[#F472B6]/30 border border-white/10 text-zinc-100 text-[11px] sm:text-xs [@media(orientation:landscape)_and_(max-height:500px)]:text-[10px] font-semibold flex items-center justify-center transition-colors select-none touch-manipulation focus:outline-none focus:ring-2 focus:ring-[#F472B6]';

  return (
    <div
      ref={containerRef}
      data-tv-keyboard="add-songs"
      role="group"
      aria-label="On-screen search keyboard"
      className="w-full mt-2 p-1.5 sm:p-2 [@media(orientation:landscape)_and_(max-height:500px)]:mt-1.5 [@media(orientation:landscape)_and_(max-height:500px)]:p-1 bg-[#08090E]/95 border border-white/10 rounded-xl space-y-1 [@media(orientation:landscape)_and_(max-height:500px)]:space-y-0.5 select-none"
    >
      {/* Row 1: Numbers 0-9 */}
      <div className="grid grid-cols-10 gap-1 [@media(orientation:landscape)_and_(max-height:500px)]:gap-0.5">
        {KEYBOARD_NUMBER_ROW.map((digit) => (
          <button
            key={digit}
            type="button"
            data-tv-id={`kb-key-${digit}`}
            data-tv-kb-key="true"
            onMouseDown={preventFocusSteal}
            onClick={() => onKeyPress(digit)}
            aria-label={digit}
            className={baseKeyClass}
          >
            {digit}
          </button>
        ))}
      </div>

      {/* Row 2: Q - P */}
      <div className="grid grid-cols-10 gap-1 [@media(orientation:landscape)_and_(max-height:500px)]:gap-0.5">
        {KEYBOARD_TOP_ALPHA_ROW.map((letter) => (
          <button
            key={letter}
            type="button"
            data-tv-id={`kb-key-${letter}`}
            data-tv-kb-key="true"
            onMouseDown={preventFocusSteal}
            onClick={() => onKeyPress(letter)}
            aria-label={letter.toUpperCase()}
            className={baseKeyClass}
          >
            {letter.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Row 3: A - L */}
      <div className="grid grid-cols-9 gap-1 [@media(orientation:landscape)_and_(max-height:500px)]:gap-0.5 px-2 sm:px-3">
        {KEYBOARD_MID_ALPHA_ROW.map((letter) => (
          <button
            key={letter}
            type="button"
            data-tv-id={`kb-key-${letter}`}
            data-tv-kb-key="true"
            onMouseDown={preventFocusSteal}
            onClick={() => onKeyPress(letter)}
            aria-label={letter.toUpperCase()}
            className={baseKeyClass}
          >
            {letter.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Row 4: Z - M + Backspace */}
      <div className="grid grid-cols-9 gap-1 [@media(orientation:landscape)_and_(max-height:500px)]:gap-0.5">
        {KEYBOARD_BOT_ALPHA_ROW.map((letter) => (
          <button
            key={letter}
            type="button"
            data-tv-id={`kb-key-${letter}`}
            data-tv-kb-key="true"
            onMouseDown={preventFocusSteal}
            onClick={() => onKeyPress(letter)}
            aria-label={letter.toUpperCase()}
            className={baseKeyClass}
          >
            {letter.toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          data-tv-id="kb-key-backspace"
          data-tv-kb-key="true"
          onMouseDown={preventFocusSteal}
          onClick={onBackspace}
          aria-label="Backspace"
          title="Backspace"
          className={`${baseKeyClass} col-span-2 bg-[#1D1F30] text-zinc-200`}
        >
          <Delete className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>

      {/* Row 5: Clear, Space, Enter/Search */}
      <div className="flex items-center gap-1 [@media(orientation:landscape)_and_(max-height:500px)]:gap-0.5">
        <button
          type="button"
          data-tv-id="kb-key-clear"
          data-tv-kb-key="true"
          onMouseDown={preventFocusSteal}
          onClick={onClear}
          aria-label="Clear search"
          className={`${baseKeyClass} px-2.5 sm:px-3 bg-[#1D1F30] text-zinc-300 shrink-0`}
        >
          Clear
        </button>
        <button
          type="button"
          data-tv-id="kb-key-space"
          data-tv-kb-key="true"
          onMouseDown={preventFocusSteal}
          onClick={() => onKeyPress(' ')}
          aria-label="Space"
          className={`${baseKeyClass} flex-1 text-zinc-400`}
        >
          Space
        </button>
        <button
          type="button"
          data-tv-id="kb-key-search"
          data-tv-kb-key="true"
          onMouseDown={preventFocusSteal}
          onClick={onSearch}
          aria-label="Search"
          className="yk-kb-key yk-kb-key-primary h-7 sm:h-8 [@media(orientation:landscape)_and_(max-height:500px)]:h-6 px-2.5 sm:px-3.5 rounded-lg bg-[#F472B6] hover:bg-[#DB2777] active:bg-[#BE185D] border border-[#F472B6]/40 text-white text-[11px] sm:text-xs [@media(orientation:landscape)_and_(max-height:500px)]:text-[10px] font-bold flex items-center justify-center gap-1 transition-colors select-none touch-manipulation shrink-0 focus:outline-none focus:ring-2 focus:ring-white"
        >
          <Search className="w-3 h-3" />
          <span>Search</span>
          <CornerDownLeft className="w-3 h-3 hidden sm:inline" />
        </button>
      </div>
    </div>
  );
};
