import type { ObjectTransform } from '@/lib/objectTransform';

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
  folderPath: string | null;
  /** Where the object has been placed in the 3D viewer. Identity for non-3D files. */
  transform: ObjectTransform;
}

export interface CommentAttachment {
  storageKey: string;
  filename: string;
  contentType: string;
  size: number;
  url?: string; // resolved presigned URL (populated on fetch)
}

export interface Comment {
  id: string;
  fileId: string;
  userId?: string | null;
  parentCommentId: string | null;
  content: string;
  xPosition: number | null;
  yPosition: number | null;
  worldX: number | null;
  worldY: number | null;
  worldZ: number | null;
  pageNumber: number | null;
  timestamp: number | null;
  author: string;
  createdAt: string;
  snapshotUrl?: string | null;
  attachments?: CommentAttachment[];
}

export interface Markup {
  id: string;
  fileId: string;
  type: 'freehand' | 'line' | 'arrow' | 'rect' | 'text';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  style: { color: string; strokeWidth: number };
  pageNumber: number | null;
  createdAt: string;
}
