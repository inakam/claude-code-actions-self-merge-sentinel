declare module "picomatch" {
  export default function picomatch(
    pattern: string,
    options: { dot: boolean },
  ): (file: string) => boolean;
}
