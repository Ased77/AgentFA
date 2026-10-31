// AgentFA: typing for the React Bits PromptBar (`PromptBar.jsx`). Only the
// props this app uses plus the upstream ones are declared; the implementation
// stays plain JavaScript and is excluded from typechecking.
import type { ReactNode } from "react";

export type PromptBarSource = {
  key: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  /** The row that opens a file picker via `onAttach`. */
  attach?: boolean;
};

export type PromptBarCommand = {
  key: string;
  /** With the leading slash, e.g. `/summarize`. */
  name: string;
  description?: string;
};

export type PromptBarModel = {
  key: string;
  name: string;
  tag?: string;
};

export type PromptBarSendMeta = {
  attachments: string[];
  model?: PromptBarModel;
  effort: string;
};

export type PromptBarLabels = {
  prompt?: string;
  send?: string;
  stop?: string;
  dictate?: string;
  stopDictate?: string;
  listening?: string;
  addSources?: string;
  chooseModel?: string;
  chooseEffort?: string;
  effortTitle?: string;
  effortHint?: string;
  effortFaster?: string;
  effortSmarter?: string;
  menuSources?: string;
  menuCommands?: string;
  menuModels?: string;
  menuEffort?: string;
  noMatches?: (query: string) => string;
  removeFile?: (file: string) => string;
};

export type PromptBarProps = {
  placeholder?: string;
  sources?: PromptBarSource[];
  commands?: PromptBarCommand[];
  models?: PromptBarModel[];
  defaultModel?: string;
  efforts?: string[];
  defaultEffort?: string;
  onEffortChange?: (effort: string) => void;
  onModelChange?: (model: PromptBarModel) => void;
  busy?: boolean;
  onSend?: (text: string, meta: PromptBarSendMeta) => void;
  onStop?: () => void;
  onAttach?: () => string | string[] | Promise<string | string[]>;
  onDictate?: () => string | Promise<string>;
  /** Translated UI strings for the component's own copy. */
  labels?: PromptBarLabels;
  /** Controlled draft: pairs with the page's own input state. */
  value?: string;
  onValueChange?: (value: string) => void;
  background?: string;
  color?: string;
  menuBackground?: string;
  sparkColor?: string;
  sparkBoost?: number;
  width?: number;
  radius?: number;
  maxRows?: number;
  morphDuration?: number;
  squash?: number;
  tilt?: number;
  pressScale?: number;
  className?: string;
};

declare function PromptBar(props: PromptBarProps): ReactNode;
export default PromptBar;
