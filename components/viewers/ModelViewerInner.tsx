'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Grid, Center } from '@react-three/drei';
import { Suspense } from 'react';

interface ModelViewerInnerProps {
  url: string;
}

function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

export default function ModelViewerInner({ url }: ModelViewerInnerProps) {
  return (
    <div className="h-full w-full" style={{ minHeight: 400 }}>
      <Canvas
        camera={{ position: [3, 3, 3], fov: 50 }}
        style={{ background: '#f0f0f0' }}
        gl={{ preserveDrawingBuffer: true }}
      >
        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[0.5, 0.5, 0.5]} />
              <meshStandardMaterial color="gray" wireframe />
            </mesh>
          }
        >
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 10, 5]} intensity={1} />
          <Center>
            <Model url={url} />
          </Center>
          <Grid
            args={[10, 10]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor="#aaa"
            sectionSize={2}
            sectionThickness={1}
            sectionColor="#888"
            fadeDistance={10}
            position={[0, -0.01, 0]}
          />
          <Environment preset="studio" />
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}
