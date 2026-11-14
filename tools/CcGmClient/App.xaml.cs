using System;
using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace CcGmClient;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        DispatcherUnhandledException += App_DispatcherUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += CurrentDomain_UnhandledException;
    }

    private void App_DispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        try
        {
            var logPath = Path.Combine(AppContext.BaseDirectory, "gm_error.log");
            File.AppendAllText(logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] Dispatcher Error: {e.Exception}\n\n");
            MessageBox.Show($"GM端运行时异常：\n{e.Exception.Message}\n\n详细信息已写入 gm_error.log", "Chess & Cards GM 错误提示", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        catch { }
        e.Handled = true;
    }

    private void CurrentDomain_UnhandledException(object sender, UnhandledExceptionEventArgs e)
    {
        try
        {
            var logPath = Path.Combine(AppContext.BaseDirectory, "gm_error.log");
            File.AppendAllText(logPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] Fatal Error: {e.ExceptionObject}\n\n");
        }
        catch { }
    }
}

