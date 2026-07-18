'use client';

/* eslint-disable @next/next/no-img-element */
import Lightbox from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';
import { useState } from 'react';
import { ImageBlock } from '@/lib/types';

const GeneratedImages = ({ block }: { block: ImageBlock }) => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-black dark:text-white font-medium text-xl">Generated image</h3>
        <p className="text-sm text-black/50 dark:text-white/50">{block.data.prompt}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {block.data.images.map((image, imageIndex) => (
          <button
            key={image.url}
            type="button"
            onClick={() => { setIndex(imageIndex); setOpen(true); }}
            className="overflow-hidden rounded-xl border border-light-200 bg-light-secondary text-left transition hover:scale-[1.01] dark:border-dark-200 dark:bg-dark-secondary"
          >
            <img
              src={image.url}
              alt={image.revisedPrompt || block.data.prompt}
              className="h-auto w-full"
            />
          </button>
        ))}
      </div>
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        index={index}
        slides={block.data.images.map((image) => ({ src: image.url }))}
      />
    </section>
  );
};

export default GeneratedImages;
