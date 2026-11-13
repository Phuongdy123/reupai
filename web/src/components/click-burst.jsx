"use client";

import { useEffect, useRef } from "react";

function drawStar(ctx, radius) {
  ctx.beginPath();
  for (let point = 0; point < 8; point += 1) {
    const angle = -Math.PI / 2 + point * Math.PI / 4;
    const distance = point % 2 === 0 ? radius : radius * 0.24;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawGem(ctx, radius, color) {
  const half = radius * 0.78;
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(half, -radius * 0.34);
  ctx.lineTo(radius * 0.66, radius * 0.48);
  ctx.lineTo(0, radius);
  ctx.lineTo(-radius * 0.66, radius * 0.48);
  ctx.lineTo(-half, -radius * 0.34);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -radius);
  ctx.lineTo(0, radius);
  ctx.moveTo(-half, -radius * 0.34);
  ctx.lineTo(radius * 0.66, radius * 0.48);
  ctx.moveTo(half, -radius * 0.34);
  ctx.lineTo(-radius * 0.66, radius * 0.48);
  ctx.strokeStyle = "rgb(255 255 255 / 78%)";
  ctx.lineWidth = 0.75;
  ctx.stroke();
}

export function ClickBurst() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let frame = 0;
    let lastFrame = 0;
    let particles = [];
    let rings = [];

    function resize() {
      pixelRatio = Math.min(window.devicePixelRatio || 1, coarsePointer ? 1 : 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function animate(now) {
      frame = 0;
      const delta = Math.min(32, lastFrame ? now - lastFrame : 16.7);
      lastFrame = now;
      context.clearRect(0, 0, width, height);

      particles = particles.filter((particle) => now - particle.born < particle.life);
      rings = rings.filter((ring) => now - ring.born < 440);

      for (const ring of rings) {
        const progress = (now - ring.born) / 440;
        context.beginPath();
        context.arc(ring.x, ring.y, 4 + progress * 43, 0, Math.PI * 2);
        context.strokeStyle = `rgba(220, 222, 255, ${(1 - progress) * 0.48})`;
        context.lineWidth = 1.4 * (1 - progress * 0.45);
        context.stroke();
      }

      for (const particle of particles) {
        const progress = Math.min(1, (now - particle.born) / particle.life);
        const fade = (1 - progress) ** 1.35;
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.vy += 0.00018 * delta;
        particle.rotation += particle.spin * delta;

        context.save();
        context.translate(particle.x, particle.y);
        context.rotate(particle.rotation);
        context.globalAlpha = fade;
        context.shadowColor = particle.color;
        context.shadowBlur = coarsePointer ? 0 : particle.type === "gem" ? 5 : 7;
        if (particle.type === "gem") drawGem(context, particle.size, particle.color);
        else {
          context.fillStyle = particle.color;
          drawStar(context, particle.size);
        }
        context.restore();
      }

      if (particles.length || rings.length) frame = window.requestAnimationFrame(animate);
      else lastFrame = 0;
    }

    function createBurst(event) {
      if (reducedMotion.matches || !event.isPrimary || event.button !== 0) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, video, audio, [contenteditable='true'], canvas")) return;

      const x = event.clientX;
      const y = event.clientY;
      const count = coarsePointer ? 5 : 12;
      const colors = ["#f5f2ff", "#d9dfff", "#c5b8ff", "#b7dcff", "#fff0c2"];
      const now = performance.now();
      if (!coarsePointer) rings.push({ x, y, born: now });

      for (let index = 0; index < count; index += 1) {
        const angle = (Math.PI * 2 * index) / count + (Math.random() - 0.5) * 0.28;
        const speed = 0.075 + Math.random() * 0.11;
        particles.push({
          x: x + Math.cos(angle) * 4,
          y: y + Math.sin(angle) * 4,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          born: now,
          life: coarsePointer ? 260 + Math.random() * 100 : 460 + Math.random() * 260,
          size: coarsePointer ? 2.5 + Math.random() * 2 : 3 + Math.random() * 3.5,
          rotation: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 0.009,
          color: colors[Math.floor(Math.random() * colors.length)],
          type: index % 3 === 0 ? "gem" : "star",
        });
      }

      if (particles.length > 84) particles = particles.slice(-84);
      if (rings.length > 6) rings = rings.slice(-6);

      if (!frame) frame = window.requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("pointerdown", createBurst, { passive: true });
    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("pointerdown", createBurst);
      if (frame) window.cancelAnimationFrame(frame);
      particles = [];
      rings = [];
    };
  }, []);

  return <canvas ref={canvasRef} className="click-burst-canvas" aria-hidden="true" />;
}
