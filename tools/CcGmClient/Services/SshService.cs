using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Renci.SshNet;

namespace CcGmClient.Services
{
    public class SshService
    {
        public static async Task ExecuteCommandAsync(
            string host,
            int port,
            string username,
            string password,
            string command,
            Action<string> onOutputLine)
        {
            await Task.Run(() =>
            {
                try
                {
                    onOutputLine($"[SSH] 正在连接目标服务器 {username}@{host}:{port} ...");
                    var connInfo = new ConnectionInfo(
                        host,
                        port,
                        username,
                        new PasswordAuthenticationMethod(username, password)
                    )
                    {
                        Timeout = TimeSpan.FromSeconds(10)
                    };

                    using var client = new SshClient(connInfo);
                    client.Connect();

                    if (!client.IsConnected)
                    {
                        onOutputLine("[SSH 错误] 无法连接到服务器，请检查网络与账密。");
                        return;
                    }

                    onOutputLine("[SSH] 已建立加密通道，正在执行远程运维指令...");
                    onOutputLine($"$ {command}");

                    using var cmd = client.CreateCommand(command);
                    var asyncResult = cmd.BeginExecute();

                    using var reader = new StreamReader(cmd.OutputStream, Encoding.UTF8);
                    using var errReader = new StreamReader(cmd.ExtendedOutputStream, Encoding.UTF8);

                    while (!asyncResult.IsCompleted)
                    {
                        while (reader.ReadLine() is { } line)
                        {
                            onOutputLine(line);
                        }
                        while (errReader.ReadLine() is { } errLine)
                        {
                            onOutputLine($"[stderr] {errLine}");
                        }
                        Task.Delay(50).Wait();
                    }

                    while (reader.ReadLine() is { } line)
                    {
                        onOutputLine(line);
                    }
                    while (errReader.ReadLine() is { } errLine)
                    {
                        onOutputLine($"[stderr] {errLine}");
                    }

                    cmd.EndExecute(asyncResult);

                    if (cmd.ExitStatus == 0)
                    {
                        onOutputLine($"[SSH 成功] 指令执行完成 (ExitCode: 0)");
                    }
                    else
                    {
                        onOutputLine($"[SSH 警告] 指令返回非零退出码: {cmd.ExitStatus}");
                    }

                    client.Disconnect();
                }
                catch (Exception ex)
                {
                    onOutputLine($"[SSH 异常] {ex.Message}");
                }
            });
        }
    }
}
