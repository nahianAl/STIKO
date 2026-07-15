export interface FileChip { label: string; bg: string; text: string }

const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'tif', 'tiff'];
const VIDEO = ['mp4', 'mov', 'webm', 'avi', 'mkv'];
const MODEL = ['glb', 'gltf', 'step', 'stp', 'obj', 'stl', '3ds', 'ply', 'dae'];
const CAD = ['dwg', 'dxf'];

/** Map a file to a colored type chip per the 1C spec. */
export function getFileChip(filename: string, fileType: string): FileChip {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (fileType === 'application/pdf' || ext === 'pdf') return { label: 'PDF', bg: '#FFE2E2', text: '#B23A52' };
  if (CAD.includes(ext)) return { label: 'DWG', bg: '#EDFFDA', text: '#4B7A28' };
  if (MODEL.includes(ext)) return { label: ext.toUpperCase(), bg: '#EBE4FD', text: '#6b4fc4' };
  if (fileType.startsWith('image/') || IMAGE.includes(ext)) return { label: 'IMG', bg: '#E2F2FF', text: '#2f7fc4' };
  if (fileType.startsWith('video/') || VIDEO.includes(ext)) return { label: 'VID', bg: '#FFFCCE', text: '#7A5E00' };
  return { label: (ext || 'FILE').toUpperCase().slice(0, 4), bg: '#EFEFF4', text: '#5A6076' };
}
