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
}

export interface Comment {
  id: string;
  fileId: string;
  parentCommentId: string | null;
  content: string;
  xPosition: number | null;
  yPosition: number | null;
  author: string;
  createdAt: string;
}

export interface Markup {
  id: string;
  fileId: string;
  type: 'freehand' | 'line' | 'arrow' | 'rect';
  data: any;
  style: { color: string; strokeWidth: number };
  createdAt: string;
}
