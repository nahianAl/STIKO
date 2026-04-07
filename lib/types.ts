export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Portal {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}

export interface Participant {
  id: string;
  portalId: string;
  email: string;
  role: 'viewer' | 'commenter' | 'uploader';
  createdAt: string;
}

export interface Version {
  id: string;
  portalId: string;
  versionNumber: number;
  createdAt: string;
}

export interface FileRecord {
  id: string;
  versionId: string;
  filename: string;
  storageKey: string;
  fileSize: number;
  fileType: string;
  createdAt: string;
  conversionStatus: 'pending' | 'processing' | 'completed' | 'failed' | null;
  convertedStorageKey: string | null;
  conversionJobId: string | null;
}

export const STEP_EXTENSIONS = ['.step', '.stp'];

export interface Comment {
  id: string;
  fileId: string;
  parentCommentId: string | null;
  content: string;
  xPosition: number | null;
  yPosition: number | null;
  author: string;
  createdAt: string;
  snapshotUrl?: string | null;
}

export interface Markup {
  id: string;
  fileId: string;
  type: 'freehand' | 'line' | 'arrow' | 'rect';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  style: { color: string; strokeWidth: number };
  createdAt: string;
}
