import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuth } from '../../context/auth';
import * as api from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ImagePlus, Paintbrush, Video, X } from 'lucide-react';
import { DrawingTool, DrawingToolHandle } from './DrawingTool';
import { downscaleImage, fileToDataUrl } from '../../lib/media';

const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20MB, enforced again server-side by multer.

interface CreatePostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPostCreated: () => void;
}

export const CreatePostModal: React.FC<CreatePostModalProps> = ({ open, onOpenChange, onPostCreated }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [content, setContent] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [video, setVideo] = useState<string | null>(null);
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [drawingMode, setDrawingMode] = useState(false);
  const drawingRef = useRef<DrawingToolHandle | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFile = async (file?: File) => {
    if (!file || !file.type.startsWith('image/')) return;
    const raw = await fileToDataUrl(file);
    const downscaled = await downscaleImage(raw);
    setImage(downscaled);
    setVideo(null);
    setDrawingMode(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleVideoFile = async (file?: File) => {
    if (!file || !file.type.startsWith('video/')) return;
    if (file.size > MAX_VIDEO_BYTES) {
      toast.error(t('post.videoTooLarge'));
      if (videoRef.current) videoRef.current.value = '';
      return;
    }
    setImage(null);
    setDrawingMode(false);
    setVideoUploading(true);
    try {
      const { url } = await api.uploadPostVideo(file);
      setVideo(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setVideoUploading(false);
      if (videoRef.current) videoRef.current.value = '';
    }
  };

  const resetAndClose = () => {
    setContent('');
    setImage(null);
    setVideo(null);
    setVideoDuration(0);
    setDrawingMode(false);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!user) return;
    const drawing = drawingMode ? drawingRef.current?.getDrawing() ?? null : null;
    if (!content.trim() && !image && !drawing && !video) {
      toast.error(t('post.needContent'));
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await api.createPost({
        content,
        imageUrl: image,
        drawingUrl: drawing,
        videoUrl: video,
        videoDuration: video ? videoDuration : null,
      });
      if (created.censored) {
        toast(t('common.editedByCensor'));
      }
      resetAndClose();
      onPostCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(o) : resetAndClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('nav.create')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('post.placeholder')}
            rows={3}
            className="resize-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4 mr-1" />
              {t('post.attachImage')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={videoUploading}
              onClick={() => videoRef.current?.click()}
            >
              <Video className="h-4 w-4 mr-1" />
              {videoUploading ? t('common.loading') : t('post.attachVideo')}
            </Button>
            <Button
              variant={drawingMode ? 'default' : 'outline'}
              size="sm"
              type="button"
              onClick={() => {
                setDrawingMode(!drawingMode);
                setImage(null);
                setVideo(null);
              }}
            >
              <Paintbrush className="h-4 w-4 mr-1" />
              {t('post.attachDrawing')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <input
              ref={videoRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleVideoFile(e.target.files?.[0])}
            />
          </div>
          {image && (
            <div className="relative">
              <img src={image} alt="preview" className="w-full rounded-lg" />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-2 right-2 h-6 w-6 rounded-full"
                onClick={() => setImage(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          {video && (
            <div className="relative">
              <video
                src={video}
                controls
                className="w-full rounded-lg"
                onLoadedMetadata={(e) => setVideoDuration(e.currentTarget.duration || 0)}
              />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute top-2 right-2 h-6 w-6 rounded-full"
                onClick={() => setVideo(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          {drawingMode && <DrawingTool ref={drawingRef} />}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={resetAndClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting || videoUploading}>
              {isSubmitting ? t('common.loading') : t('common.publish')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};