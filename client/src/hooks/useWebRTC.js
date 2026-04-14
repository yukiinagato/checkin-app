import { useCallback, useEffect, useRef, useState } from 'react';

export const CAMERA_ERRORS = {
  UNSUPPORTED: 'UNSUPPORTED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  UNKNOWN: 'UNKNOWN'
};

const mapCameraError = (error) => {
  if (!error) return { code: CAMERA_ERRORS.UNKNOWN, message: 'Unknown camera error.' };

  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return { code: CAMERA_ERRORS.PERMISSION_DENIED, message: 'Camera access was denied.' };
  }

  if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
    return { code: CAMERA_ERRORS.NOT_FOUND, message: 'No compatible camera was found.' };
  }

  return { code: CAMERA_ERRORS.UNKNOWN, message: error.message || 'Unable to access camera.' };
};

export const useWebRTC = ({ facingMode = 'environment' } = {}) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [isActive, setIsActive] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      const error = { code: CAMERA_ERRORS.UNSUPPORTED, message: 'This browser does not support camera APIs.' };
      setCameraError(error);
      return { ok: false, error };
    }

    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraError(null);
      setIsActive(true);
      return { ok: true };
    } catch (error) {
      const normalizedError = mapCameraError(error);
      setCameraError(normalizedError);
      stopCamera();
      return { ok: false, error: normalizedError };
    }
  }, [facingMode, stopCamera]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;

    const canvas = canvasRef.current || document.createElement('canvas');
    canvasRef.current = canvas;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  return {
    videoRef,
    isActive,
    cameraError,
    startCamera,
    stopCamera,
    captureFrame
  };
};
