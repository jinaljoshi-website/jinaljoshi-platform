// ps/src/hooks/useUpload.js
// Shared hook for uploading files via R2 presigned URLs

import { useState } from 'react';
import { api } from '../api';

export function useUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [error,     setError]     = useState('');

  const upload = async (file, context = 'chat_media') => {
    setError(''); setUploading(true); setProgress(0);
    try {
      // 1. Get presigned URL from backend
      const { uploadUrl, key, publicUrl } = await api.post('/api/upload/presign', {
        filename:    file.name,
        contentType: file.type,
        context,
      });

      // 2. Upload directly to R2
      await fetch(uploadUrl, {
        method:  'PUT',
        body:    file,
        headers: { 'Content-Type': file.type },
      });

      setProgress(100);
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      return { key, publicUrl, mediaType };
    } catch (err) {
      setError(err.message || 'Upload failed');
      return null;
    } finally {
      setUploading(false);
    }
  };

  return { upload, uploading, progress, error };
}