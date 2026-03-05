import { ThemeProvider as NextThemesProvider } from "next-themes";

// TODO: Customize defaultTheme and storageKey if needed.
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" {...props}>
      {children}
    </NextThemesProvider>
  );
}
