"use client";

import { useEffect, useRef } from "react";

export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const colors = [
      "#108CE9", "#8B5CF6", "#EC4899", "#F59E0B",
      "#10B981", "#06B6D4", "#F43F5E", "#FBBF24",
    ];
    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      gravity: number;
      size: number;
      rotation: number;
      rotationSpeed: number;
      color: string;
      shape: "rect" | "circle";
      opacity: number;
      life: number;
    };
    const particles: Particle[] = [];
    const PARTICLE_COUNT = 180;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 200,
        y: canvas.height * 0.2 + (Math.random() - 0.5) * 80,
        vx: (Math.random() - 0.5) * 14,
        vy: Math.random() * -10 - 4,
        gravity: 0.28 + Math.random() * 0.1,
        size: 6 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.3,
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: Math.random() < 0.5 ? "rect" : "circle",
        opacity: 1,
        life: 0,
      });
    }

    let frameCount = 0;
    const MAX_FRAMES = 280; // ~4.5s at 60fps

    const draw = () => {
      frameCount++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let aliveCount = 0;
      for (const p of particles) {
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.99;
        p.rotation += p.rotationSpeed;

        if (frameCount > MAX_FRAMES * 0.65) {
          p.opacity = Math.max(0, 1 - (frameCount - MAX_FRAMES * 0.65) / (MAX_FRAMES * 0.35));
        }

        if (p.y > canvas.height + 40 || p.opacity <= 0) continue;
        aliveCount++;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = p.opacity;
        ctx.fillStyle = p.color;

        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (frameCount < MAX_FRAMES && aliveCount > 0) {
        animationRef.current = requestAnimationFrame(draw);
      }
    };
    animationRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        pointerEvents: "none",
        zIndex: 999,
      }}
    />
  );
}
