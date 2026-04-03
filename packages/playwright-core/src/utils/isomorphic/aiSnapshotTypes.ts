/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type AISnapshotBackend = 'aria' | 'custom-dom';

export type AICustomDomStableId = string;
export type AICustomDomLocatorPlan = Record<string, any>;

export type AICustomDomTreeNode = {
  id?: AICustomDomStableId;
  children?: AICustomDomTreeNode[];
  [key: string]: any;
};

export type AICustomDomFrameData = {
  dom: AICustomDomTreeNode | Record<string, any>;
  stableIds: AICustomDomStableId[];
  idOrder: AICustomDomStableId[];
  locatorPlans: Record<AICustomDomStableId, AICustomDomLocatorPlan>;
};

export type AICustomDomFrameSnapshot = AICustomDomFrameData & {
  frameId: string;
  frameSeq: number;
  url: string;
  name: string;
  childFrameIndex?: number;
  childFrames: AICustomDomFrameSnapshot[];
};

export type AICustomDomSnapshotEnvelope = {
  backend: 'custom-dom';
  version: 1;
  page: {
    url: string;
    frameTree: AICustomDomFrameSnapshot;
  };
};

export type AISnapshotEnvelope = AICustomDomSnapshotEnvelope;

export type AISnapshotResult =
  | {
    backend: 'aria';
    full: string;
    incremental?: string;
    envelope?: undefined;
  }
  | {
    backend: 'custom-dom';
    full: string;
    incremental?: string;
    envelope: AISnapshotEnvelope;
  };
