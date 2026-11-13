using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CcGmClient.Models
{
    public class GmConfig
    {
        [JsonPropertyName("serverUrl")]
        public string ServerUrl { get; set; } = "http://82.157.54.179";

        [JsonPropertyName("adminToken")]
        public string AdminToken { get; set; } = "2f6f6fe8e5cced301026985a44a26192fcf1b6f1cf2ef218";

        [JsonPropertyName("host")]
        public string Host { get; set; } = "82.157.54.179";

        [JsonPropertyName("port")]
        public string Port { get; set; } = "22";

        [JsonPropertyName("username")]
        public string Username { get; set; } = "ubuntu";

        [JsonPropertyName("password")]
        public string Password { get; set; } = "Lss@971115520";

        [JsonPropertyName("remoteDir")]
        public string RemoteDir { get; set; } = "/opt/chess-and-cards";

        [JsonPropertyName("site")]
        public string Site { get; set; } = "http://82.157.54.179/lobby";

        private static string? _resolvedPath;

        public static string ResolveConfigPath()
        {
            if (_resolvedPath != null) return _resolvedPath;

            var candidates = new[]
            {
                Path.Combine(AppContext.BaseDirectory, ".gm-config.json"),
                Path.Combine(AppContext.BaseDirectory, "..", ".gm-config.json"),
                Path.Combine(AppContext.BaseDirectory, "..", "..", ".gm-config.json"),
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".gm-config.json"),
                Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "tools", ".gm-config.json"),
                Path.Combine(Environment.CurrentDirectory, "tools", ".gm-config.json"),
                Path.Combine(Environment.CurrentDirectory, ".gm-config.json"),
                @"E:\Chess and Cards\tools\.gm-config.json"
            };

            foreach (var candidate in candidates)
            {
                try
                {
                    var full = Path.GetFullPath(candidate);
                    if (File.Exists(full))
                    {
                        _resolvedPath = full;
                        return full;
                    }
                }
                catch { }
            }

            _resolvedPath = Path.Combine(AppContext.BaseDirectory, ".gm-config.json");
            return _resolvedPath;
        }

        public static GmConfig Load()
        {
            var path = ResolveConfigPath();
            try
            {
                if (File.Exists(path))
                {
                    var json = File.ReadAllText(path);
                    var cfg = JsonSerializer.Deserialize<GmConfig>(json);
                    if (cfg != null)
                    {
                        if (string.IsNullOrEmpty(cfg.ServerUrl))
                        {
                            cfg.ServerUrl = !string.IsNullOrEmpty(cfg.Host) ? $"http://{cfg.Host}" : "http://82.157.54.179";
                        }
                        return cfg;
                    }
                }
            }
            catch { }

            return new GmConfig();
        }

        public void Save()
        {
            var path = ResolveConfigPath();
            try
            {
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(path, json);
            }
            catch { }
        }
    }
}
