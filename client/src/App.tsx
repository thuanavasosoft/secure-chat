import { useEffect, useState } from "react";
import { Auth } from "./components/Auth";
import { Chat } from "./components/Chat";
import { getMe, type User } from "./lib/api";
import { Card, CardContent } from "./components/ui/card";

const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMe()
      .then((me) => setUser(me))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Không thể tải phiên đăng nhập."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <main className="container flex min-h-screen items-center justify-center py-8">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 text-center">Đang tải...</CardContent>
        </Card>
      </main>
    );
  }
  if (error) {
    return (
      <main className="container flex min-h-screen items-center justify-center py-8">
        <Card className="w-full max-w-md border-destructive/40">
          <CardContent className="p-6 text-center text-destructive">{error}</CardContent>
        </Card>
      </main>
    );
  }
  if (!user) {
    return <Auth onAuthenticated={setUser} />;
  }
  return <Chat currentUser={user} onLoggedOut={() => setUser(null)} />;
};

export default App;
